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

/**
 * ルート（メソッド + URL の部分一致）ごとに応答を返す。
 * 1 回のサービス呼び出しで 2 本叩く経路（`subdomains.diff` / `subdomains.apply`）用。
 * どれにも当たらない要求は 500 にして、想定外の呼び出しをテストで拾う。
 */
interface StubRoute {
  method: string;
  /** URL に含まれる文字列。`/subdomain-plan/apply` のように長い方を先に並べる。 */
  path: string;
  status?: number;
  body: unknown;
}

function stubFetchRoutes(routes: readonly StubRoute[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const url = request ? request.url : String(input);
      const method = request?.method ?? init?.method ?? "GET";
      calls.push({
        url,
        method,
        body: typeof init?.body === "string" ? init.body : null,
        contentType: new Headers(init?.headers).get("content-type"),
      });
      const route = routes.find(
        (candidate) =>
          candidate.method === method && url.includes(candidate.path),
      );
      const body =
        route === undefined
          ? { error: { code: "INTERNAL", message: `未定義のルート ${url}` } }
          : route.body;
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: route === undefined ? 500 : (route.status ?? 200),
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

/**
 * `GET /domains/:name` などの詳細エンベロープ（packages/shared の
 * `domainDetailResponseSchema` と同じ形）。`domain.registrant` は
 * レジストリのコンタクト ID で、画面に出す氏名・メールは `registrantProfile` から取る。
 */
function apiDetail(overrides: Record<string, unknown> = {}) {
  return {
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
      sponsoringRegistrarId: null,
      rgpStatuses: [],
    },
    summary: apiSummary(),
    registrantProfile: {
      name: "Taro Test",
      email: "taro.test@example.com",
      street: "N/A",
      city: "N/A",
      countryCode: "JP",
    },
    subdomainPlan: null,
    stale: false,
    syncedAt: "2026-08-26T00:00:00.000Z",
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
    stubFetch(
      200,
      apiDetail({
        summary: apiSummary({
          stale: true,
          syncedAt: "2026-08-25T12:00:00.000Z",
        }),
        stale: true,
        syncedAt: "2026-08-25T12:00:00.000Z",
      }),
    );

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

  it("サブドメイン設計の件数をそのまま画面用に渡す（#217）", async () => {
    stubFetch(200, apiDetail({ subdomainPlan: { hosts: 4, applied: 2 } }));

    const detail = await services().domains.get("example.com");

    expect(detail.subdomainPlan).toEqual({ hosts: 4, applied: 2 });
  });

  it("設計が未保存なら subdomainPlan は null（カードは「未作成」）", async () => {
    stubFetch(200, apiDetail());

    expect(
      (await services().domains.get("example.com")).subdomainPlan,
    ).toBeNull();
  });

  it("RGP の猶予期限を summary から取り、無ければ null のまま渡す（#211）", async () => {
    stubFetch(
      200,
      apiDetail({
        summary: apiSummary({
          statuses: ["pendingDelete"],
          rgpStatuses: ["redemptionPeriod"],
          rgpUntil: "2026-09-25T00:00:00.000Z",
        }),
      }),
    );

    const detail = await services().domains.get("example.com");

    expect(detail.displayStatus).toBe("rgp");
    expect(detail.rgpUntil).toBe("2026-09-25T00:00:00.000Z");
  });
});

describe("domains.update（PATCH /domains/:name。FR-09）", () => {
  it("コンタクトを body に載せる（住所は D-02 に入力欄が無いので既定値で埋める・#172）", async () => {
    stubFetch(200, apiDetail());

    await services().domains.update("example.com", {
      nameservers: ["ns1.example.com", "ns2.example.com"],
      contacts: {
        registrant: { name: "Hanako Test", email: "hanako.test@example.net" },
      },
    });

    expect(calls[0]?.method).toBe("PATCH");
    expect(JSON.parse(calls[0]?.body ?? "null")).toEqual({
      nameservers: ["ns1.example.com", "ns2.example.com"],
      contacts: {
        registrant: {
          name: "Hanako Test",
          email: "hanako.test@example.net",
          street: "N/A",
          city: "N/A",
          countryCode: "JP",
        },
      },
    });
  });

  it("ロックの付与を clientStatuses.add で送る（#205）", async () => {
    stubFetch(200, apiDetail());

    await services().domains.update("example.com", {
      nameservers: ["ns1.example.com", "ns2.example.com"],
      clientStatuses: { add: ["clientTransferProhibited"] },
    });

    expect(JSON.parse(calls[0]?.body ?? "null")).toEqual({
      nameservers: ["ns1.example.com", "ns2.example.com"],
      clientStatuses: { add: ["clientTransferProhibited"] },
    });
  });

  it("渡されなかった項目は body に載せない（解除だけの要求を unlockOnly 経路に乗せる・#205）", async () => {
    stubFetch(200, apiDetail());

    await services().domains.update("example.com", {
      clientStatuses: { remove: ["clientTransferProhibited"] },
    });

    expect(JSON.parse(calls[0]?.body ?? "null")).toEqual({
      clientStatuses: { remove: ["clientTransferProhibited"] },
    });
  });

  it("登録者は registrantProfile から取る（domain.registrant はコンタクト ID・#172）", async () => {
    stubFetch(200, apiDetail());

    const detail = await services().domains.update("example.com", {
      nameservers: ["ns1.example.com", "ns2.example.com"],
    });

    expect(detail.registrant).toMatchObject({
      name: "Taro Test",
      email: "taro.test@example.com",
    });
  });

  it("registrantProfile が null なら氏名・メールは空にする（中身を知らない・S-39）", async () => {
    stubFetch(200, apiDetail({ registrantProfile: null }));

    const detail = await services().domains.get("example.com");

    expect(detail.registrant).toMatchObject({ name: "", email: "" });
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

describe("settings.demoReset（POST /demo/reset。FR-16）", () => {
  it("同一オリジンの /api/v1/demo/reset を POST する（AC-16-1）", async () => {
    stubFetch(200, { ok: true, domains: ["dopamin-demo-a1b2.com"] });

    await expect(services().settings.demoReset()).resolves.toBeUndefined();

    expect(calls[0]?.url).toContain("/api/v1/demo/reset");
    expect(calls[0]?.method).toBe("POST");
  });

  it("無効な環境の 404 は NOT_FOUND として投げる（AC-16-1）", async () => {
    stubFetch(404, {
      error: {
        code: "NOT_FOUND",
        message: "デモデータリセットはこの環境では利用できません。",
        retryable: false,
      },
    });

    const error = await services()
      .settings.demoReset()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("NOT_FOUND");
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
        message: "AI が 20 秒以内に応答しませんでした。",
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

// ---- サブドメイン設計（FR-13 / #187） ----

const PLAN_PATH = "/api/v1/domains/example.com/subdomain-plan";
const APPLY_PATH = `${PLAN_PATH}/apply`;
const DNS_PATH = "/api/v1/domains/example.com/dns";

/** `GET /domains/:name/subdomain-plan` の 1 項目（shared の subdomainPlanItemSchema と同じ形）。 */
function apiPlanItem(overrides: Record<string, unknown> = {}) {
  return {
    host: "www",
    purpose: "ランディングページ",
    recordType: "A",
    target: "203.0.113.10",
    priority: "required",
    applyState: "applied",
    ...overrides,
  };
}

/** 保存済み設計の応答（shared の subdomainPlanResponseSchema と同じ形）。 */
function apiPlan(overrides: Record<string, unknown> = {}) {
  return {
    domain: "example.com",
    repoUrl: "https://github.com/takutaku/example",
    policy: "www と api を分ける",
    items: [apiPlanItem()],
    savedAt: "2026-08-27T00:00:00.000Z",
    appliedAt: "2026-08-27T00:05:00.000Z",
    instructions: "example.com のサブドメイン設定手順",
    ...overrides,
  };
}

/** §10.3 の統一エラー形式。 */
function apiError(code: string, message: string, retryable = false) {
  return { error: { code, message, retryable } };
}

describe("subdomains.get（GET /domains/:name/subdomain-plan。FR-13）", () => {
  it("applyState を applyStatus に写し、ホスト名を ID に使う（AC-13-6）", async () => {
    stubFetch(200, {
      ...apiPlan(),
      items: [
        apiPlanItem(),
        apiPlanItem({
          host: "api",
          purpose: "API サーバー",
          recordType: "CNAME",
          target: "api.example-app.com",
          priority: "recommended",
          applyState: "changed",
        }),
        apiPlanItem({
          host: "docs",
          purpose: "ドキュメント",
          recordType: "CNAME",
          target: "docs.example-app.com",
          priority: "optional",
          applyState: "unapplied",
        }),
      ],
    });

    const plan = await services().subdomains.get("example.com");

    expect(calls[0]?.url).toContain(PLAN_PATH);
    expect(calls[0]?.method).toBe("GET");
    expect(plan).toEqual({
      domain: "example.com",
      repoUrl: "https://github.com/takutaku/example",
      policy: "www と api を分ける",
      hosts: [
        {
          id: "www",
          host: "www",
          purpose: "ランディングページ",
          recordType: "A",
          target: "203.0.113.10",
          priority: "required",
          applyStatus: "applied",
        },
        {
          id: "api",
          host: "api",
          purpose: "API サーバー",
          recordType: "CNAME",
          target: "api.example-app.com",
          priority: "recommended",
          applyStatus: "changed",
        },
        {
          id: "docs",
          host: "docs",
          purpose: "ドキュメント",
          recordType: "CNAME",
          target: "docs.example-app.com",
          priority: "optional",
          applyStatus: "pending",
        },
      ],
      nameserversSwitched: true,
      savedAt: "2026-08-27T00:00:00.000Z",
      appliedAt: "2026-08-27T00:05:00.000Z",
    });
  });

  it("未反映（appliedAt が null）なら NS は未切替として出す（S-43 / AC-13-5）", async () => {
    stubFetch(200, apiPlan({ appliedAt: null }));

    const plan = await services().subdomains.get("example.com");

    expect(plan?.nameserversSwitched).toBe(false);
  });

  it("未保存の 404 は例外ではなく null（S-40 の空状態）", async () => {
    stubFetch(404, apiError("NOT_FOUND", "まだ保存されていません。"));

    await expect(services().subdomains.get("example.com")).resolves.toBeNull();
  });

  it("404 以外の失敗はそのまま投げる", async () => {
    stubFetch(401, apiError("UNAUTHORIZED", "ログインが必要です。"));

    const error = await services()
      .subdomains.get("example.com")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("UNAUTHORIZED");
  });

  it("応答の形が違えば INTERNAL（自前 API 側の問題）", async () => {
    stubFetch(200, { ...apiPlan(), savedAt: "きのう" });

    const error = await services()
      .subdomains.get("example.com")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("INTERNAL");
  });
});

describe("subdomains.propose（POST /domains/:name/subdomain-plan。FR-13）", () => {
  const PROPOSAL = {
    domain: "example.com",
    repoUrl: "https://github.com/takutaku/example",
    policy: "www と api を分ける",
    items: [apiPlanItem({ applyState: undefined })].map(
      ({ applyState: _ignored, ...item }) => item,
    ),
  };

  it("リポジトリ URL を JSON で送り、提案は未保存・未反映として返す（AC-13-1）", async () => {
    stubFetch(200, PROPOSAL);

    const plan = await services().subdomains.propose("example.com", {
      repoUrl: "https://github.com/takutaku/example",
    });

    expect(calls[0]?.url).toContain(PLAN_PATH);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.contentType).toBe("application/json");
    expect(JSON.parse(calls[0]?.body ?? "null")).toEqual({
      repoUrl: "https://github.com/takutaku/example",
    });
    expect(plan).toEqual({
      domain: "example.com",
      repoUrl: "https://github.com/takutaku/example",
      policy: "www と api を分ける",
      hosts: [
        {
          id: "www",
          host: "www",
          purpose: "ランディングページ",
          recordType: "A",
          target: "203.0.113.10",
          priority: "required",
          applyStatus: "pending",
        },
      ],
      nameserversSwitched: false,
      savedAt: null,
      appliedAt: null,
    });
  });

  it("概要テキストだけでも提案できる（AC-13-2 の代替入力）", async () => {
    stubFetch(200, { ...PROPOSAL, repoUrl: null });

    const plan = await services().subdomains.propose("example.com", {
      description: "個人のポートフォリオサイト",
    });

    expect(JSON.parse(calls[0]?.body ?? "null")).toEqual({
      description: "個人のポートフォリオサイト",
    });
    expect(plan.repoUrl).toBeNull();
  });

  it("AI 側の失敗には origin: ai を付ける（S-41 の Banner Warn + 再試行）", async () => {
    stubFetch(503, apiError("AI_UNAVAILABLE", "AI が利用できません。", true));

    const error = await services()
      .subdomains.propose("example.com", { repoUrl: "https://github.com/a/b" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("AI_UNAVAILABLE");
    expect((error as ApiClientError).origin).toBe("ai");
    // 相手を付け替えても本文・再試行可否は API の応答のまま残す
    expect((error as ApiClientError).message).toBe("AI が利用できません。");
    expect((error as ApiClientError).retryable).toBe(true);
  });

  it("リポジトリを取得できない NOT_FOUND には相手を付けない（S-42 の概要入力へ倒す）", async () => {
    stubFetch(404, apiError("NOT_FOUND", "リポジトリを取得できません。"));

    const error = await services()
      .subdomains.propose("example.com", { repoUrl: "https://github.com/a/b" })
      .catch((e: unknown) => e);

    expect((error as ApiClientError).code).toBe("NOT_FOUND");
    expect((error as ApiClientError).origin).toBeUndefined();
  });

  it("RATE_LIMITED は GitHub / AI のどちらでも返るので相手を断定しない", async () => {
    stubFetch(429, apiError("RATE_LIMITED", "利用制限に達しました。", true));

    const error = await services()
      .subdomains.propose("example.com", { repoUrl: "https://github.com/a/b" })
      .catch((e: unknown) => e);

    expect((error as ApiClientError).code).toBe("RATE_LIMITED");
    expect((error as ApiClientError).origin).toBeUndefined();
  });
});

describe("subdomains.save（PUT /domains/:name/subdomain-plan。FR-13）", () => {
  const DRAFT = {
    domain: "example.com",
    repoUrl: "https://github.com/takutaku/example",
    policy: "www と api を分ける",
    hosts: [
      {
        id: "draft-2",
        host: "www",
        purpose: "ランディングページ",
        recordType: "A" as const,
        target: "203.0.113.10",
        priority: "required" as const,
        applyStatus: "pending" as const,
      },
    ],
    nameserversSwitched: false,
    savedAt: null,
    appliedAt: null,
  };

  it("設計だけを PUT し、画面側の ID・反映状態は送らない（AC-13-3）", async () => {
    stubFetch(200, apiPlan({ appliedAt: null }));

    await services().subdomains.save("example.com", DRAFT);

    expect(calls[0]?.url).toContain(PLAN_PATH);
    expect(calls[0]?.method).toBe("PUT");
    expect(JSON.parse(calls[0]?.body ?? "null")).toEqual({
      policy: "www と api を分ける",
      items: [
        {
          host: "www",
          purpose: "ランディングページ",
          recordType: "A",
          target: "203.0.113.10",
          priority: "required",
        },
      ],
      repoUrl: "https://github.com/takutaku/example",
    });
  });

  it("repoUrl が無い設計では repoUrl を送らない（スキーマ上も任意）", async () => {
    stubFetch(200, apiPlan({ repoUrl: null, appliedAt: null }));

    await services().subdomains.save("example.com", {
      ...DRAFT,
      repoUrl: null,
    });

    expect(JSON.parse(calls[0]?.body ?? "null")).not.toHaveProperty("repoUrl");
  });

  it("保存後の反映状態はサーバーの応答をそのまま写す（AC-13-6）", async () => {
    stubFetch(200, {
      ...apiPlan({ appliedAt: null }),
      items: [apiPlanItem({ applyState: "changed" })],
    });

    const saved = await services().subdomains.save("example.com", DRAFT);

    expect(saved.hosts[0]?.applyStatus).toBe("changed");
    expect(saved.savedAt).toBe("2026-08-27T00:00:00.000Z");
  });
});

describe("subdomains.diff（GET /domains/:name/dns。FR-13）", () => {
  it("差分を写し、用途・重要度は保存済み設計から補う（AC-13-7）", async () => {
    stubFetchRoutes([
      {
        method: "GET",
        path: DNS_PATH,
        body: {
          records: [
            {
              host: "api",
              recordType: "CNAME",
              target: "old.example-app.com",
              ttl: 3600,
              source: "subdomain_plan",
              appliedAt: "2026-08-27T00:05:00.000Z",
            },
            {
              host: "old",
              recordType: "A",
              target: "203.0.113.99",
              ttl: 300,
              source: "subdomain_plan",
              appliedAt: "2026-08-27T00:05:00.000Z",
            },
          ],
          diff: {
            added: [
              {
                host: "docs",
                recordType: "CNAME",
                target: "docs.example-app.com",
                ttl: 3600,
              },
            ],
            changed: [
              {
                current: {
                  host: "api",
                  recordType: "CNAME",
                  target: "old.example-app.com",
                  ttl: 3600,
                  source: "subdomain_plan",
                  appliedAt: "2026-08-27T00:05:00.000Z",
                },
                desired: {
                  host: "api",
                  recordType: "CNAME",
                  target: "api.example-app.com",
                  ttl: 3600,
                },
              },
            ],
            removed: [
              {
                host: "old",
                recordType: "A",
                target: "203.0.113.99",
                ttl: 300,
                source: "subdomain_plan",
                appliedAt: "2026-08-27T00:05:00.000Z",
              },
            ],
            unchanged: [
              {
                host: "www",
                recordType: "A",
                target: "203.0.113.10",
                ttl: 3600,
              },
            ],
          },
        },
      },
      {
        method: "GET",
        path: PLAN_PATH,
        body: {
          ...apiPlan(),
          items: [
            apiPlanItem(),
            apiPlanItem({
              host: "api",
              purpose: "API サーバー",
              recordType: "CNAME",
              target: "api.example-app.com",
              priority: "recommended",
              applyState: "changed",
            }),
            apiPlanItem({
              host: "docs",
              purpose: "ドキュメント",
              recordType: "CNAME",
              target: "docs.example-app.com",
              priority: "optional",
              applyState: "unapplied",
            }),
          ],
        },
      },
    ]);

    const diff = await services().subdomains.diff("example.com");

    expect(calls.map((call) => call.method)).toEqual(["GET", "GET"]);
    expect(diff).toEqual({
      added: [
        {
          id: "docs",
          host: "docs",
          purpose: "ドキュメント",
          recordType: "CNAME",
          target: "docs.example-app.com",
          priority: "optional",
          applyStatus: "pending",
        },
      ],
      updated: [
        {
          host: {
            id: "api",
            host: "api",
            purpose: "API サーバー",
            recordType: "CNAME",
            target: "api.example-app.com",
            priority: "recommended",
            applyStatus: "changed",
          },
          previous: {
            host: "api",
            recordType: "CNAME",
            target: "old.example-app.com",
            ttl: 3600,
          },
        },
      ],
      removed: [
        { host: "old", recordType: "A", target: "203.0.113.99", ttl: 300 },
      ],
      unchanged: ["www"],
    });
  });

  it("設計が未保存なら差分も空（サーバーが空の diff を返す）", async () => {
    stubFetchRoutes([
      {
        method: "GET",
        path: DNS_PATH,
        body: {
          records: [],
          diff: { added: [], changed: [], removed: [], unchanged: [] },
        },
      },
      {
        method: "GET",
        path: PLAN_PATH,
        status: 404,
        body: apiError("NOT_FOUND", "まだ保存されていません。"),
      },
    ]);

    await expect(services().subdomains.diff("example.com")).resolves.toEqual({
      added: [],
      updated: [],
      removed: [],
      unchanged: [],
    });
  });
});

describe("subdomains.apply（POST .../subdomain-plan/apply。FR-13）", () => {
  it("件数を返しつつ、反映後の設計を取り直す（AC-13-4）", async () => {
    stubFetchRoutes([
      {
        method: "POST",
        path: APPLY_PATH,
        body: { added: 2, updated: 1, removed: 0, nameserversChanged: true },
      },
      { method: "GET", path: PLAN_PATH, body: apiPlan() },
    ]);

    const result = await services().subdomains.apply("example.com");

    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toContain(APPLY_PATH);
    expect(calls[1]?.method).toBe("GET");
    expect(result).toMatchObject({
      added: 2,
      updated: 1,
      removed: 0,
      nameserversChanged: true,
    });
    // 反映が通った = NS はドパ民 DNS（切替に失敗すれば apply ごと失敗する・AC-13-5）
    expect(result.plan.nameserversSwitched).toBe(true);
    expect(result.plan.appliedAt).toBe("2026-08-27T00:05:00.000Z");
    expect(result.plan.hosts[0]?.applyStatus).toBe("applied");
  });

  it("NS 切替に失敗したら反映自体が失敗し、設計は取り直さない（S-46 / AC-13-5）", async () => {
    stubFetchRoutes([
      {
        method: "POST",
        path: APPLY_PATH,
        status: 503,
        body: apiError(
          "REGISTRY_UNAVAILABLE",
          "レジストリに接続できませんでした。",
          true,
        ),
      },
      { method: "GET", path: PLAN_PATH, body: apiPlan() },
    ]);

    const error = await services()
      .subdomains.apply("example.com")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("REGISTRY_UNAVAILABLE");
    expect(calls).toHaveLength(1);
  });
});

// ---- ログ（FR-14 / FR-15 / #187） ----

describe("logs.operations（GET /logs/operations。FR-15）", () => {
  it("1 ページで取り、request / response をそのまま画面に渡す（AC-15-2）", async () => {
    stubFetch(200, {
      items: [
        {
          id: "5b1d5a1e-6d0f-4f3d-9f21-2f7b1f4b0a11",
          at: "2026-08-27T00:00:00.000Z",
          command: "create",
          registry: "kitaqsign",
          domainName: "example.com",
          status: "error",
          errorCode: "REGISTRY_UNAVAILABLE",
          registryCode: "2400",
          latencyMs: 1200,
          requestId: "req_1",
          request: { name: "example.com", pw: "***" },
          response: { code: 2400 },
        },
      ],
      nextCursor: null,
    });

    const logs = await services().logs.operations();

    expect(calls[0]?.url).toContain("/api/v1/logs/operations");
    expect(calls[0]?.url).toContain("limit=100");
    expect(logs).toEqual([
      {
        id: "5b1d5a1e-6d0f-4f3d-9f21-2f7b1f4b0a11",
        at: "2026-08-27T00:00:00.000Z",
        command: "create",
        registry: "kitaqsign",
        domainName: "example.com",
        status: "error",
        errorCode: "REGISTRY_UNAVAILABLE",
        registryCode: "2400",
        latencyMs: 1200,
        request: { name: "example.com", pw: "***" },
        response: { code: 2400 },
      },
    ]);
  });

  it("0 件でも空配列で返す（S-60 の Empty State）", async () => {
    stubFetch(200, { items: [], nextCursor: null });

    await expect(services().logs.operations()).resolves.toEqual([]);
  });
});

describe("logs.ai（GET /logs/ai。FR-14）", () => {
  /** `GET /logs/ai` の 1 件（shared の aiLogItemSchema と同じ形）。 */
  function apiAiLog(overrides: Record<string, unknown> = {}) {
    return {
      id: "0f2a0f6f-2c1d-4d0f-8d3a-9b6b5f0e1c22",
      at: "2026-08-27T00:00:00.000Z",
      feature: "subdomain_plan",
      provider: "google",
      model: "gemini-2.5-flash",
      inputSummary: "example.com / repo あり",
      outputSummary: "www・api・docs の 3 ホスト",
      status: "success",
      errorMessage: null,
      latencyMs: 4200,
      tokensIn: 900,
      tokensOut: 350,
      output: { policy: "www と api を分ける" },
      ...overrides,
    };
  }

  it("入出力トークンを合計し、構造化出力を raw に載せる（AC-14-1）", async () => {
    stubFetch(200, { items: [apiAiLog()], nextCursor: null });

    const logs = await services().logs.ai();

    expect(calls[0]?.url).toContain("/api/v1/logs/ai");
    expect(logs[0]).toEqual({
      id: "0f2a0f6f-2c1d-4d0f-8d3a-9b6b5f0e1c22",
      at: "2026-08-27T00:00:00.000Z",
      feature: "subdomain_plan",
      provider: "google",
      model: "gemini-2.5-flash",
      inputSummary: "example.com / repo あり",
      outputSummary: "www・api・docs の 3 ホスト",
      status: "success",
      latencyMs: 4200,
      tokens: 1250,
      raw: { policy: "www と api を分ける" },
    });
  });

  it("トークン数が取れなかった失敗ログは tokens を null のまま出す（AC-14-1）", async () => {
    stubFetch(200, {
      items: [
        apiAiLog({
          status: "error",
          errorMessage: "AI が 20 秒以内に応答しませんでした。",
          outputSummary: "（失敗）",
          tokensIn: null,
          tokensOut: null,
          output: null,
        }),
      ],
      nextCursor: null,
    });

    const [log] = await services().logs.ai();

    expect(log?.status).toBe("error");
    expect(log?.tokens).toBeNull();
  });
});
