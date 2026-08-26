import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../errors";
import type { Services } from "../services";
import { createHttpServices } from "./http-services";

/**
 * HTTP 実装の応答検証と ViewModel への写像（fe-ui 設計 §4.6 / FR-02）。
 * fetch を差し替えて、API の JSON がそのまま画面用の型になることを確かめる。
 */

interface Call {
  url: string;
  method: string;
  /** 送った JSON ボディ（無ければ null）。 */
  body: string | null;
  contentType: string | null;
}

const calls: Call[] = [];

/** 次の fetch が返す応答を固定する。 */
function stubFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      calls.push({
        url: request ? request.url : String(input),
        method: request?.method ?? init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null,
        contentType: new Headers(init?.headers).get("content-type"),
      });
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
    }),
  );
}

function services(): Services {
  return createHttpServices();
}

/** `GET /domains` の 1 件分（packages/shared の domainSummarySchema と同じ形）。 */
function apiSummary(overrides: Record<string, unknown> = {}) {
  return {
    name: "example.com",
    sld: "example",
    tld: "com",
    registry: "kitaqsign",
    statuses: ["ok"],
    rgpStatuses: [],
    ownership: "owned",
    registeredAt: "2026-08-01T00:00:00.000Z",
    expiresAt: "2027-08-01T00:00:00.000Z",
    rgpUntil: null,
    syncedAt: "2026-08-26T00:00:00.000Z",
    stale: false,
    transfer: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe("domains.list（GET /domains）", () => {
  it("同一オリジンの /api/v1/domains を叩き、displayStatus を導出して返す", async () => {
    stubFetch(200, { domains: [apiSummary()] });

    const list = await services().domains.list();

    expect(calls[0]?.url).toContain("/api/v1/domains");
    expect(calls[0]?.method).toBe("GET");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: "example.com",
      sld: "example",
      tld: "com",
      registry: "kitaqsign",
      ownership: "owned",
      syncedAt: "2026-08-26T00:00:00.000Z",
      stale: false,
      displayStatus: "active",
    });
  });

  it.each([
    [{ rgpStatuses: ["redemptionPeriod"] }, "rgp"],
    [{ statuses: ["pendingDelete"] }, "pending_delete"],
    [{ statuses: ["inactive"] }, "inactive"],
    [{ statuses: ["clientHold"] }, "hold"],
    [
      {
        statuses: ["pendingTransfer"],
        transfer: { direction: "out", actByAt: "2026-08-26T00:20:00.000Z" },
      },
      "transfer_out_pending",
    ],
  ])(
    "displayStatus は deriveDisplayStatus に委ねる（UI 側で再解釈しない）",
    async (overrides, expected) => {
      stubFetch(200, { domains: [apiSummary(overrides)] });
      const [domain] = await services().domains.list();
      expect(domain?.displayStatus).toBe(expected);
    },
  );

  it("stale なキャッシュ行はそのまま stale として返す（AC-07-2）", async () => {
    stubFetch(200, {
      domains: [
        apiSummary({ stale: true, syncedAt: "2026-08-25T00:00:00.000Z" }),
      ],
    });
    const [domain] = await services().domains.list();
    expect(domain?.stale).toBe(true);
    expect(domain?.syncedAt).toBe("2026-08-25T00:00:00.000Z");
  });

  it("0 件でも例外にしない", async () => {
    stubFetch(200, { domains: [] });
    await expect(services().domains.list()).resolves.toEqual([]);
  });

  it("形が違う応答は INTERNAL（レジストリのせいにしない）", async () => {
    stubFetch(200, { domains: [{ name: "broken.com" }] });
    await expect(services().domains.list()).rejects.toMatchObject({
      code: "INTERNAL",
    });
  });

  it("401 は統一エラー形式のまま ApiClientError になる（AC-01-3）", async () => {
    stubFetch(401, {
      error: {
        code: "UNAUTHORIZED",
        message: "ログインが必要です。",
        retryable: false,
        requestId: "req_1",
      },
    });
    const error = await services()
      .domains.list()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ code: "UNAUTHORIZED", requestId: "req_1" });
  });
});

describe("domains.sync（POST /domains/sync）", () => {
  it("失敗が無ければ最新化した一覧と空の failures を返す", async () => {
    stubFetch(200, { domains: [apiSummary()], failures: [] });

    const result = await services().domains.sync();

    expect(calls[0]?.url).toContain("/api/v1/domains/sync");
    expect(calls[0]?.method).toBe("POST");
    expect(result.domains[0]?.displayStatus).toBe("active");
    expect(result.failures).toEqual([]);
  });

  it("部分失敗（200 + failures）でも例外にせず、成功行と stale 行の両方を返す（S-13）", async () => {
    stubFetch(200, {
      domains: [
        apiSummary(),
        apiSummary({
          name: "ng.xyz",
          sld: "ng",
          tld: "xyz",
          registry: "kitaqnic",
          stale: true,
          syncedAt: "2026-08-25T00:00:00.000Z",
        }),
      ],
      failures: [
        {
          name: "ng.xyz",
          code: "REGISTRY_UNAVAILABLE",
          message: "Kitaqnic に接続できません。",
        },
      ],
    });

    const result = await services().domains.sync();

    // 一覧は捨てない。捨てると失敗行の stale がキャッシュに入らず S-13 が出せない
    expect(result.domains).toHaveLength(2);
    expect(result.domains[0]).toMatchObject({
      name: "example.com",
      stale: false,
    });
    expect(result.domains[1]).toMatchObject({
      name: "ng.xyz",
      stale: true,
      syncedAt: "2026-08-25T00:00:00.000Z",
    });
    // 落ちた相手は TLD から引く（Banner の見出しを具体名にする）
    expect(result.failures).toEqual([
      {
        name: "ng.xyz",
        code: "REGISTRY_UNAVAILABLE",
        message: "Kitaqnic に接続できません。",
        registry: "kitaqnic",
      },
    ]);
  });

  it("両レジストリが落ちているときは failures に両方の registry が載る", async () => {
    stubFetch(200, {
      domains: [],
      failures: [
        { name: "a.com", code: "REGISTRY_TIMEOUT", message: "timeout" },
        { name: "b.xyz", code: "REGISTRY_TIMEOUT", message: "timeout" },
      ],
    });

    const { failures } = await services().domains.sync();

    expect(failures.map((f) => f.registry)).toEqual(["kitaqsign", "kitaqnic"]);
  });

  it("未対応 TLD の失敗は registry を特定しない（null）", async () => {
    stubFetch(200, {
      domains: [],
      failures: [
        {
          name: "a.example",
          code: "VALIDATION_ERROR",
          message: "未対応の TLD です。",
        },
      ],
    });

    const { failures } = await services().domains.sync();

    expect(failures[0]?.registry).toBeNull();
  });

  it("リクエスト自体が失敗したときは例外にする（401 / 5xx）", async () => {
    stubFetch(401, {
      error: {
        code: "UNAUTHORIZED",
        message: "ログインが必要です。",
        retryable: false,
      },
    });

    const error = await services()
      .domains.sync()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("domains.get（GET /domains/:name）", () => {
  it("summary から所有権・同期時刻・stale を取る（一覧と表示がずれない）", async () => {
    stubFetch(200, {
      domain: {
        name: "example.com",
        registry: "kitaqsign",
        statuses: ["ok"],
        registrant: "C-1",
        contacts: {},
        nameservers: ["ns1.example.com", "ns2.example.com"],
        registeredAt: "2026-08-01T00:00:00.000Z",
        updatedAt: null,
        expiresAt: "2027-08-01T00:00:00.000Z",
        lastTransferAt: null,
        rgpStatuses: [],
      },
      summary: apiSummary({
        stale: true,
        syncedAt: "2026-08-25T12:00:00.000Z",
      }),
      stale: true,
      syncedAt: "2026-08-25T12:00:00.000Z",
    });

    const detail = await services().domains.get("example.com");

    expect(detail).toMatchObject({
      name: "example.com",
      ownership: "owned",
      displayStatus: "active",
      stale: true,
      syncedAt: "2026-08-25T12:00:00.000Z",
      nameservers: ["ns1.example.com", "ns2.example.com"],
    });
    // 移管可能日は登録日 + 60 日（参考表示）
    expect(detail.transferableFrom).toBe("2026-09-30T00:00:00.000Z");
  });
});

// ---- settings（FR-17 / requirements §10.1） ----

/** `GET /auth/me` の応答（packages/shared の meResponseSchema と同じ形）。 */
const ME = {
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    displayName: "たくたく",
  },
  features: { demoReset: false },
  ai: {
    provider: "google",
    model: "gemini-2.5-flash",
    providers: [
      { id: "google", models: ["gemini-2.5-flash", "gemini-2.5-pro"] },
    ],
  },
};

describe("transfers.request（POST /transfers。FR-12）", () => {
  it("正規化 TransferResult の DTO を画面用 Transfer に写す", async () => {
    stubFetch(202, {
      transfer: {
        name: "move.com",
        status: "pending",
        registryStatus: "pending",
        requestingRegistrarId: "REG-DOPAMIN",
        actingRegistrarId: "REG-OTHER",
        requestedAt: "2026-08-26T10:00:00.000Z",
        actByAt: "2026-08-26T10:20:00.000Z",
      },
    });

    const transfer = await services().transfers.request({
      name: "move.com",
      authCode: "s3cr3t",
    });

    expect(calls[0]).toMatchObject({ method: "POST" });
    expect(calls[0]?.url).toContain("/api/v1/transfers");
    expect(transfer).toMatchObject({
      id: "move.com",
      domainName: "move.com",
      direction: "in",
      status: "pending",
    });
  });

  it("必須フィールドが欠けていれば INTERNAL（API との契約ずれを検知する）", async () => {
    stubFetch(202, { transfer: { name: "move.com" } });

    const error = await services()
      .transfers.request({ name: "move.com", authCode: "s3cr3t" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("INTERNAL");
  });

  it("status が未知の値なら INTERNAL（正規化ユニオン外は受け取らない）", async () => {
    stubFetch(202, {
      transfer: { name: "move.com", status: "clientApproved" },
    });

    const error = await services()
      .transfers.request({ name: "move.com", authCode: "s3cr3t" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("INTERNAL");
  });
});

describe("settings.me（GET /auth/me）", () => {
  it("同一オリジンの /api/v1/auth/me を GET し、meResponseSchema で検証した結果を返す", async () => {
    stubFetch(200, ME);

    const me = await services().settings.me();

    expect(me).toEqual(ME);
    expect(calls[0]?.url).toBe("/api/v1/auth/me");
    expect(calls[0]?.method).toBe("GET");
  });

  it("200 でも形が違えば INTERNAL の ApiClientError", async () => {
    stubFetch(200, { user: ME.user });

    const error = await services()
      .settings.me()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("INTERNAL");
  });

  it("401 は UNAUTHORIZED の ApiClientError（status ではなくコードで判定）", async () => {
    stubFetch(401, {
      error: {
        code: "UNAUTHORIZED",
        message: "ログインが必要です。",
        retryable: false,
        requestId: "req_test",
      },
    });

    const error = await services()
      .settings.me()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("UNAUTHORIZED");
    expect((error as ApiClientError).requestId).toBe("req_test");
  });
});

describe("settings.updateAi（PATCH /settings/ai）", () => {
  it("/api/v1/settings/ai に JSON を PATCH し、aiSettingsResponseSchema で検証して返す", async () => {
    stubFetch(200, { ...ME.ai, provider: "google", model: "gemini-2.5-pro" });

    const ai = await services().settings.updateAi({
      provider: "google",
      model: "gemini-2.5-pro",
    });

    expect(ai.model).toBe("gemini-2.5-pro");
    expect(calls[0]?.url).toBe("/api/v1/settings/ai");
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.contentType).toBe("application/json");
    expect(JSON.parse(calls[0]?.body ?? "null")).toEqual({
      provider: "google",
      model: "gemini-2.5-pro",
    });
  });

  it("無効プロバイダの 400 VALIDATION_ERROR を ApiClientError に変換する", async () => {
    stubFetch(400, {
      error: {
        code: "VALIDATION_ERROR",
        message: "このプロバイダは有効化されていません。",
        retryable: false,
        requestId: "req_test",
        details: { provider: "anthropic", enabledProviders: ["google"] },
      },
    });

    const error = await services()
      .settings.updateAi({ provider: "anthropic", model: "claude-haiku-4-5" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("VALIDATION_ERROR");
    expect((error as ApiClientError).retryable).toBe(false);
  });
});

describe("settings.demoReset（POST /demo/reset）", () => {
  it("API 未実装のため NOT_IMPLEMENTED のまま（FR-16 は別トラック）", async () => {
    stubFetch(200, {});
    const error = await services()
      .settings.demoReset()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("NOT_IMPLEMENTED");
    expect(calls).toHaveLength(0);
  });
});

describe("domains.check（FR-03 / FR-05）", () => {
  it("uniqueness の topSimilar を nearest へ写像し、null はそのまま通す", async () => {
    stubFetch(200, {
      results: [
        {
          name: "googel.com",
          registry: "kitaqsign",
          availability: "available",
          uniqueness: {
            score: 12,
            label: "low",
            topSimilar: [{ name: "google", similarity: 0.95 }],
            confidence: "normal",
            algorithmVersion: "v3.4-r2-ts.1",
            corpusVersion: "tranco-74V4X-2026-08-26-top10k+curated-v1",
          },
        },
        {
          name: "taken.com",
          registry: "kitaqsign",
          availability: "unavailable",
          uniqueness: null,
        },
      ],
    });
    const results = await services().domains.check({
      names: ["googel.com", "taken.com"],
    });
    expect(results[0]?.uniqueness).toEqual({
      score: 12,
      label: "low",
      nearest: [{ name: "google", similarity: 0.95 }],
    });
    expect(results[1]?.uniqueness).toBeNull();
  });
});
