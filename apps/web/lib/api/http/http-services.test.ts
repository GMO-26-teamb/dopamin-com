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
        // 両レジストリの info に clID が無いため当面は null（§11.1 / ADR-0002 決定 4）
        sponsoringRegistrarId: null,
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

// ---- 移管（FR-12 / #175） ----

/** `POST /transfers` の応答の `transfer`（正規化 TransferResult の DTO）。 */
const TRANSFER_DTO = {
  name: "move.com",
  status: "pending",
  registryStatus: "pending",
  requestingRegistrarId: "REG-DOPAMIN",
  actingRegistrarId: "REG-OTHER",
  requestedAt: "2026-08-26T10:00:00.000Z",
  actByAt: "2026-08-26T10:20:00.000Z",
};

const OUT_ID = "11111111-1111-4111-8111-111111111111";
const IN_ID = "22222222-2222-4222-8222-222222222222";
const HISTORY_ID = "33333333-3333-4333-8333-333333333333";

/** `GET /transfers` の 1 件分（packages/shared の transferSummarySchema と同じ形）。 */
function apiTransferSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: OUT_ID,
    domainName: "move.com",
    registry: "kitaqsign",
    direction: "out",
    status: "pending",
    requestedAt: "2026-08-26T10:00:00.000Z",
    actByAt: "2026-08-26T10:20:00.000Z",
    completedAt: null,
    domainId: null,
    ...overrides,
  };
}

describe("transfers.list（GET /transfers）", () => {
  it("outbound / inbound / history を 1 本の Transfer[] に平坦化して返す", async () => {
    stubFetch(200, {
      inbound: [
        apiTransferSummary({
          id: IN_ID,
          domainName: "in.com",
          direction: "in",
        }),
      ],
      outbound: [apiTransferSummary()],
      history: [
        apiTransferSummary({
          id: HISTORY_ID,
          domainName: "gone.com",
          status: "approved",
          completedAt: "2026-08-26T10:30:00.000Z",
          domainId: "dom-1",
        }),
      ],
    });

    const list = await services().transfers.list();

    expect(calls[0]?.url).toContain("/api/v1/transfers");
    expect(calls[0]?.method).toBe("GET");
    expect(list).toHaveLength(3);
    expect(list).toContainEqual({
      id: OUT_ID,
      domainName: "move.com",
      registry: "kitaqsign",
      direction: "out",
      status: "pending",
      requestedAt: "2026-08-26T10:00:00.000Z",
      actByAt: "2026-08-26T10:20:00.000Z",
      completedAt: null,
    });
    expect(list).toContainEqual(
      expect.objectContaining({
        id: IN_ID,
        direction: "in",
        status: "pending",
      }),
    );
    expect(list).toContainEqual(
      expect.objectContaining({ id: HISTORY_ID, status: "approved" }),
    );
  });

  it("IN の approved で domainId が無い行は import_pending（取り込み待ち）に写す", async () => {
    stubFetch(200, {
      inbound: [],
      outbound: [],
      history: [
        apiTransferSummary({
          direction: "in",
          status: "approved",
          completedAt: "2026-08-26T10:30:00.000Z",
          domainId: null,
        }),
      ],
    });

    const [transfer] = await services().transfers.list();

    expect(transfer?.status).toBe("import_pending");
  });

  it("IN の approved でも domainId が付いた行は approved のまま（取り込み済みの履歴）", async () => {
    stubFetch(200, {
      inbound: [],
      outbound: [],
      history: [
        apiTransferSummary({
          direction: "in",
          status: "approved",
          completedAt: "2026-08-26T10:30:00.000Z",
          domainId: "dom-1",
        }),
      ],
    });

    const [transfer] = await services().transfers.list();

    expect(transfer?.status).toBe("approved");
  });

  it("requestedAt が null の行は completedAt で埋める（履歴の日付表示用）", async () => {
    stubFetch(200, {
      inbound: [],
      outbound: [],
      history: [
        apiTransferSummary({
          status: "rejected",
          requestedAt: null,
          actByAt: null,
          completedAt: "2026-08-26T10:30:00.000Z",
        }),
      ],
    });

    const [transfer] = await services().transfers.list();

    expect(transfer?.requestedAt).toBe("2026-08-26T10:30:00.000Z");
  });

  it("形が違う応答は INTERNAL（API との契約ずれを検知する）", async () => {
    stubFetch(200, { inbound: [{ id: "broken" }], outbound: [], history: [] });

    const error = await services()
      .transfers.list()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("INTERNAL");
  });

  it("401 は UNAUTHORIZED の ApiClientError（AC-01-3）", async () => {
    stubFetch(401, {
      error: {
        code: "UNAUTHORIZED",
        message: "ログインが必要です。",
        retryable: false,
        requestId: "req_1",
      },
    });

    const error = await services()
      .transfers.list()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ code: "UNAUTHORIZED", requestId: "req_1" });
  });
});

describe("transfers.refresh（S-50「状態を更新」）", () => {
  it("GET /transfers を叩き直す（Poll 消化 + transferQuery はサーバ側で走る）", async () => {
    stubFetch(200, {
      inbound: [],
      outbound: [apiTransferSummary()],
      history: [],
    });

    const list = await services().transfers.refresh();

    expect(calls[0]?.url).toContain("/api/v1/transfers");
    expect(calls[0]?.method).toBe("GET");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: OUT_ID, direction: "out" });
  });
});

describe("transfers.approve / reject / cancel（POST /transfers/:id/*。FR-12）", () => {
  it("approve は /api/v1/transfers/:id/approve に POST し、承認済みの行を返す（AC-12-4）", async () => {
    stubFetch(200, {
      transfer: apiTransferSummary({
        status: "approved",
        completedAt: "2026-08-26T10:05:00.000Z",
        actByAt: null,
      }),
    });

    const transfer = await services().transfers.approve(OUT_ID);

    expect(calls[0]?.url).toContain(`/api/v1/transfers/${OUT_ID}/approve`);
    expect(calls[0]?.method).toBe("POST");
    expect(transfer).toMatchObject({
      id: OUT_ID,
      direction: "out",
      status: "approved",
      completedAt: "2026-08-26T10:05:00.000Z",
    });
  });

  it("reject は /api/v1/transfers/:id/reject に POST し、拒否済みの行を返す（AC-12-4）", async () => {
    stubFetch(200, {
      transfer: apiTransferSummary({
        status: "rejected",
        completedAt: "2026-08-26T10:05:00.000Z",
        actByAt: null,
      }),
    });

    const transfer = await services().transfers.reject(OUT_ID);

    expect(calls[0]?.url).toContain(`/api/v1/transfers/${OUT_ID}/reject`);
    expect(transfer).toMatchObject({ id: OUT_ID, status: "rejected" });
  });

  it("cancel は /api/v1/transfers/:id/cancel に POST し、取消済みの行を返す", async () => {
    stubFetch(200, {
      transfer: apiTransferSummary({
        id: IN_ID,
        direction: "in",
        status: "cancelled",
        completedAt: "2026-08-26T10:05:00.000Z",
        actByAt: null,
      }),
    });

    const transfer = await services().transfers.cancel(IN_ID);

    expect(calls[0]?.url).toContain(`/api/v1/transfers/${IN_ID}/cancel`);
    expect(transfer).toMatchObject({ id: IN_ID, status: "cancelled" });
  });

  it("409 OPERATION_NOT_ALLOWED は ApiClientError のまま画面に渡す", async () => {
    stubFetch(409, {
      error: {
        code: "OPERATION_NOT_ALLOWED",
        message: "この移管は操作できません。",
        retryable: false,
        requestId: "req_2",
      },
    });

    const error = await services()
      .transfers.approve(OUT_ID)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      code: "OPERATION_NOT_ALLOWED",
      retryable: false,
    });
  });
});

describe("transfers.request（POST /transfers。FR-12）", () => {
  it("永続化された record（uuid）を画面用 Transfer に写す", async () => {
    stubFetch(202, {
      transfer: TRANSFER_DTO,
      record: apiTransferSummary({ id: IN_ID, direction: "in" }),
    });

    const transfer = await services().transfers.request({
      name: "move.com",
      authCode: "s3cr3t",
    });

    expect(calls[0]).toMatchObject({ method: "POST" });
    expect(calls[0]?.url).toContain("/api/v1/transfers");
    expect(transfer).toMatchObject({
      // id はドメイン名ではなく transfers 行の uuid（取消 API が uuid を要求する）
      id: IN_ID,
      domainName: "move.com",
      registry: "kitaqsign",
      direction: "in",
      status: "pending",
      requestedAt: "2026-08-26T10:00:00.000Z",
      actByAt: "2026-08-26T10:20:00.000Z",
    });
  });

  it("record が欠けていれば INTERNAL（API との契約ずれを検知する）", async () => {
    stubFetch(202, { transfer: TRANSFER_DTO });

    const error = await services()
      .transfers.request({ name: "move.com", authCode: "s3cr3t" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("INTERNAL");
  });

  it("transfer.status が未知の値なら INTERNAL（正規化ユニオン外は受け取らない）", async () => {
    stubFetch(202, {
      transfer: { ...TRANSFER_DTO, status: "clientApproved" },
      record: apiTransferSummary({ id: IN_ID, direction: "in" }),
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

// ---- AI 候補生成（FR-04 / #178） ----

/** `POST /ai/domain-candidates` の候補 1 件分（shared の domainCandidateResultSchema と同じ形）。 */
function apiCandidate(overrides: Record<string, unknown> = {}) {
  return {
    sld: "takutaku",
    tld: "com",
    reason: "覚えやすく短い",
    check: {
      name: "takutaku.com",
      registry: "kitaqsign",
      availability: "available",
      uniqueness: {
        score: 82,
        label: "high",
        topSimilar: [{ name: "taku", similarity: 0.42 }],
        confidence: "normal",
        algorithmVersion: "v3.4-r2-ts.1",
        corpusVersion: "tranco-74V4X-2026-08-26-top10k+curated-v1",
      },
    },
    ...overrides,
  };
}

describe("candidates.generate（POST /ai/domain-candidates。FR-04）", () => {
  it("同一オリジンの /api/v1/ai/domain-candidates に JSON を POST する", async () => {
    stubFetch(200, { candidates: [apiCandidate()] });

    await services().candidates.generate({
      nickname: "たくたく",
      purpose: "ポートフォリオ",
      tlds: ["com"],
      exclude: ["taku.com"],
    });

    expect(calls[0]?.url).toContain("/api/v1/ai/domain-candidates");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.contentType).toBe("application/json");
    expect(JSON.parse(calls[0]?.body ?? "null")).toEqual({
      nickname: "たくたく",
      purpose: "ポートフォリオ",
      tlds: ["com"],
      exclude: ["taku.com"],
    });
  });

  it("候補に理由と空き確認・独自性スコアが載る（AC-04-1 / topSimilar → nearest）", async () => {
    stubFetch(200, { candidates: [apiCandidate()] });

    const [candidate] = await services().candidates.generate({
      nickname: "たくたく",
    });

    expect(candidate).toEqual({
      sld: "takutaku",
      tld: "com",
      reason: "覚えやすく短い",
      registry: "kitaqsign",
      availability: "available",
      uniqueness: {
        score: 82,
        label: "high",
        nearest: [{ name: "taku", similarity: 0.42 }],
      },
      alternatives: [],
    });
  });

  it("空きでない候補は uniqueness: null のまま通す（§10.4）", async () => {
    stubFetch(200, {
      candidates: [
        apiCandidate({
          check: {
            name: "taken.com",
            registry: "kitaqsign",
            availability: "unavailable",
            reason: "登録済み",
            uniqueness: null,
          },
        }),
      ],
    });

    const [candidate] = await services().candidates.generate({
      nickname: "たくたく",
    });

    expect(candidate?.availability).toBe("unavailable");
    expect(candidate?.uniqueness).toBeNull();
  });

  it("レジストリ障害の行でもスコアは付く（AC-05-2。検索経路と同じ写像）", async () => {
    stubFetch(200, {
      candidates: [
        apiCandidate({
          check: {
            name: "takutaku.com",
            registry: null,
            availability: "error",
            uniqueness: {
              score: 82,
              label: "high",
              topSimilar: [],
              confidence: "normal",
              algorithmVersion: "v3.4-r2-ts.1",
              corpusVersion: "tranco-74V4X-2026-08-26-top10k+curated-v1",
            },
            error: {
              code: "REGISTRY_UNAVAILABLE",
              message: "レジストリに接続できませんでした。",
            },
          },
        }),
      ],
    });

    const [candidate] = await services().candidates.generate({
      nickname: "たくたく",
    });

    expect(candidate?.availability).toBe("error");
    // 未対応 TLD / 障害で registry: null が返っても ViewModel は null を持てない
    expect(candidate?.registry).toBe("mock");
    expect(candidate?.uniqueness?.score).toBe(82);
  });

  it("0 件でも例外にしない（揃った分だけ返す実装に合わせる）", async () => {
    stubFetch(200, { candidates: [] });
    await expect(
      services().candidates.generate({ nickname: "たくたく" }),
    ).resolves.toEqual([]);
  });

  it("形が違う応答は INTERNAL（API との契約ずれを検知する）", async () => {
    stubFetch(200, { candidates: [{ sld: "broken" }] });

    const error = await services()
      .candidates.generate({ nickname: "たくたく" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("INTERNAL");
  });

  it('503 AI_UNAVAILABLE は origin: "ai" 付きで返す（S-23 の文言出し分け）', async () => {
    stubFetch(503, {
      error: {
        code: "AI_UNAVAILABLE",
        message: "AI 機能が利用できません。",
        retryable: true,
        requestId: "req_ai",
      },
    });

    const error = await services()
      .candidates.generate({ nickname: "たくたく" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      code: "AI_UNAVAILABLE",
      origin: "ai",
      retryable: true,
      requestId: "req_ai",
    });
  });

  it("AI のタイムアウト（REGISTRY_TIMEOUT）も AI の失敗として扱う（AC-04-2）", async () => {
    stubFetch(504, {
      error: {
        code: "REGISTRY_TIMEOUT",
        message: "AI が 10 秒以内に応答しませんでした。",
        retryable: true,
      },
    });

    const error = await services()
      .candidates.generate({ nickname: "たくたく" })
      .catch((e: unknown) => e);
    // レジストリ用の文言に落ちないよう origin で相手を明示する
    expect(error).toMatchObject({ code: "REGISTRY_TIMEOUT", origin: "ai" });
  });

  it("401 は UNAUTHORIZED（requireSession。AC-01-3）", async () => {
    stubFetch(401, {
      error: {
        code: "UNAUTHORIZED",
        message: "ログインが必要です。",
        retryable: false,
      },
    });

    const error = await services()
      .candidates.generate({ nickname: "たくたく" })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "UNAUTHORIZED", origin: "ai" });
  });
});
