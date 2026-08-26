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
  it("失敗が無ければ最新化した一覧を返す", async () => {
    stubFetch(200, { domains: [apiSummary()], failures: [] });

    const list = await services().domains.sync();

    expect(calls[0]?.url).toContain("/api/v1/domains/sync");
    expect(calls[0]?.method).toBe("POST");
    expect(list[0]?.displayStatus).toBe("active");
  });

  it("部分失敗（200 + failures）は例外に変換し、落ちたレジストリを載せる（S-13）", async () => {
    stubFetch(200, {
      domains: [apiSummary({ stale: true })],
      failures: [
        {
          name: "ng.xyz",
          code: "REGISTRY_UNAVAILABLE",
          message: "Kitaqnic に接続できません。",
        },
      ],
    });

    const error = await services()
      .domains.sync()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      code: "REGISTRY_UNAVAILABLE",
      message: "Kitaqnic に接続できません。",
      // TLD からレジストリを特定して Banner の見出しを具体名にする
      registry: "kitaqnic",
      retryable: true,
    });
  });

  it("両レジストリが落ちているときは registry を特定しない", async () => {
    stubFetch(200, {
      domains: [],
      failures: [
        { name: "a.com", code: "REGISTRY_TIMEOUT", message: "timeout" },
        { name: "b.xyz", code: "REGISTRY_TIMEOUT", message: "timeout" },
      ],
    });

    const error = (await services()
      .domains.sync()
      .catch((e: unknown) => e)) as ApiClientError;
    expect(error.code).toBe("REGISTRY_TIMEOUT");
    expect(error.registry).toBeUndefined();
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
