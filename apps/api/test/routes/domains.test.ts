import {
  createRegistrySet,
  MockRegistryAdapter,
  type RegistryAdapter,
  RegistryError,
  type RegistryErrorCode,
} from "@dopamin/registry";
import { type ApiErrorBody, apiErrorBodySchema } from "@dopamin/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../src/index";
import { setRegistrySetForTesting } from "../../src/lib/registries";
import { TimeoutMockAdapter } from "../helpers/timeout-mock";

/**
 * Hono ルートの統合テスト（docs/requirements.md §19 integration）。
 * kitaqsign / kitaqnic を名乗る 2 つの MockRegistryAdapter を注入し、
 * TLD ルーティング・エラー変換・部分失敗を本番と同じ経路で検証する。
 */

interface DomainPayload {
  domain: {
    name: string;
    registry: string;
    statuses: string[];
    nameservers: string[];
    rgpStatuses: string[];
    expiresAt: string | null;
  } | null;
}

interface CheckPayload {
  results: Array<{
    name: string;
    registry: string | null;
    availability: "available" | "unavailable" | "error";
    reason?: string;
    error?: { code: string; message: string };
  }>;
}

let kitaqnic: MockRegistryAdapter;

beforeEach(() => {
  kitaqnic = new MockRegistryAdapter({ id: "kitaqnic" });
  setRegistrySetForTesting(
    createRegistrySet({
      mode: "real",
      adapters: [new MockRegistryAdapter({ id: "kitaqsign" }), kitaqnic],
    }),
  );
  // errorHandler の構造化ログでテスト出力が汚れないようにする
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  setRegistrySetForTesting(null);
  vi.restoreAllMocks();
});

async function api(path: string, init?: RequestInit): Promise<Response> {
  return app.request(`/api/v1${path}`, init);
}

function sendJson(
  path: string,
  body: unknown,
  method = "POST",
): Promise<Response> {
  return api(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createDomain(name: string, period = 1): Promise<DomainPayload> {
  const res = await sendJson("/domains", { name, period });
  expect(res.status).toBe(201);
  return (await res.json()) as DomainPayload;
}

async function parseError(res: Response): Promise<ApiErrorBody> {
  return apiErrorBodySchema.parse(await res.json());
}

describe("POST /api/v1/domains/check（FR-03）", () => {
  it("names 形式: レジストリ跨ぎでルーティングされ、入力順で結果が返る", async () => {
    const res = await sendJson("/domains/check", {
      names: ["foo.com", "bar.xyz"],
    });
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as CheckPayload;
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      name: "foo.com",
      registry: "kitaqsign",
      availability: "available",
    });
    expect(results[1]).toMatchObject({
      name: "bar.xyz",
      registry: "kitaqnic",
      availability: "available",
    });
  });

  it("sld + tlds 形式: FQDN に展開して確認する", async () => {
    const res = await sendJson("/domains/check", {
      sld: "foo",
      tlds: ["com", "xyz"],
    });
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as CheckPayload;
    expect(results.map((r) => r.name)).toEqual(["foo.com", "foo.xyz"]);
  });

  it("重複したドメイン名は排除される", async () => {
    const res = await sendJson("/domains/check", {
      names: ["dup.com", "dup.com"],
    });
    const { results } = (await res.json()) as CheckPayload;
    expect(results).toHaveLength(1);
  });

  it("登録済みドメインは unavailable になる", async () => {
    await createDomain("taken.com");
    const res = await sendJson("/domains/check", { names: ["taken.com"] });
    const { results } = (await res.json()) as CheckPayload;
    expect(results[0]?.availability).toBe("unavailable");
  });

  it("未対応 TLD は個別エラー項目になる（全体は 200）", async () => {
    const res = await sendJson("/domains/check", {
      names: ["foo.example", "ok.com"],
    });
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as CheckPayload;
    expect(results[0]).toMatchObject({
      registry: null,
      availability: "error",
      error: { code: "VALIDATION_ERROR" },
    });
    expect(results[1]?.availability).toBe("available");
  });

  it("AC-03-2: 一方のレジストリが落ちても他方の結果は返る（部分失敗）", async () => {
    kitaqnic.setFailMode("5xx");
    const res = await sendJson("/domains/check", {
      names: ["ok.com", "ng.xyz"],
    });
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as CheckPayload;
    expect(results[0]?.availability).toBe("available");
    expect(results[1]).toMatchObject({
      registry: "kitaqnic",
      availability: "error",
      error: { code: "REGISTRY_UNAVAILABLE" },
    });
  });

  it("空の names は 400 VALIDATION_ERROR", async () => {
    const res = await sendJson("/domains/check", { names: [] });
    expect(res.status).toBe(400);
    const body = await parseError(res);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("不正な JSON ボディは 400 VALIDATION_ERROR", async () => {
    const res = await api("/domains/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{oops",
    });
    expect(res.status).toBe(400);
    const body = await parseError(res);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/v1/domains（FR-06 登録）", () => {
  it("201: 登録されて DomainInfo が返る（NS 未指定は inactive）", async () => {
    const res = await sendJson("/domains", { name: "new.com", period: 2 });
    expect(res.status).toBe(201);
    const { domain } = (await res.json()) as DomainPayload;
    expect(domain).toMatchObject({ name: "new.com", registry: "kitaqsign" });
    expect(domain?.statuses).toContain("inactive");
    expect(domain?.rgpStatuses).toContain("addPeriod");
  });

  it("TLD に応じて登録先レジストリが変わる", async () => {
    const { domain } = await createDomain("new.xyz");
    expect(domain?.registry).toBe("kitaqnic");
  });

  it("NS 付き登録は inactive にならない", async () => {
    const res = await sendJson("/domains", {
      name: "withns.com",
      period: 1,
      nameservers: ["ns1.example.com", "ns2.example.com"],
    });
    const { domain } = (await res.json()) as DomainPayload;
    expect(domain?.statuses).not.toContain("inactive");
  });

  it("登録済みドメインは 409 CONFLICT（登録前の再 check）", async () => {
    await createDomain("dup.com");
    const res = await sendJson("/domains", { name: "dup.com", period: 1 });
    expect(res.status).toBe(409);
    const body = await parseError(res);
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.retryable).toBe(false);
  });

  it("period 0 は 400 VALIDATION_ERROR（details に項目が載る）", async () => {
    const res = await sendJson("/domains", { name: "p0.com", period: 0 });
    expect(res.status).toBe(400);
    const body = await parseError(res);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(body.error.details)).toBe(true);
  });
});

describe("GET /api/v1/domains/:name（FR-07 詳細）", () => {
  it("200: 登録済みドメインの情報を返す", async () => {
    await createDomain("info.com");
    const res = await api("/domains/info.com");
    expect(res.status).toBe(200);
    const { domain } = (await res.json()) as DomainPayload;
    expect(domain?.name).toBe("info.com");
  });

  it("未登録は 404 NOT_FOUND（registry / registryCode 付き）", async () => {
    const res = await api("/domains/ghost.com");
    expect(res.status).toBe(404);
    const body = await parseError(res);
    expect(body.error).toMatchObject({
      code: "NOT_FOUND",
      registry: "kitaqsign",
      registryCode: "2303",
      retryable: false,
    });
  });

  it("不正なドメイン名は 400 VALIDATION_ERROR", async () => {
    const res = await api("/domains/-bad.com");
    expect(res.status).toBe(400);
    expect((await parseError(res)).error.code).toBe("VALIDATION_ERROR");
  });

  it("未対応 TLD は 400 VALIDATION_ERROR（supportedTlds を返す）", async () => {
    const res = await api("/domains/foo.example");
    expect(res.status).toBe(400);
    const body = await parseError(res);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    const details = body.error.details as { supportedTlds: string[] };
    expect(details.supportedTlds).toContain("com");
  });
});

describe("POST /api/v1/domains/:name/renew（FR-08 更新）", () => {
  it("200: 有効期限が延長される", async () => {
    const { domain: before } = await createDomain("renew.com");
    const res = await sendJson("/domains/renew.com/renew", { period: 1 });
    expect(res.status).toBe(200);
    const { domain } = (await res.json()) as DomainPayload;
    expect(new Date(domain?.expiresAt ?? 0).getTime()).toBeGreaterThan(
      new Date(before?.expiresAt ?? 0).getTime(),
    );
  });

  it("AC-08-2: 合計有効期間が 10 年を超える更新は 400", async () => {
    await createDomain("limit.com", 5);
    const res = await sendJson("/domains/limit.com/renew", { period: 6 });
    expect(res.status).toBe(400);
    expect((await parseError(res)).error.code).toBe("VALIDATION_ERROR");
  });

  it("clientRenewProhibited 中は 409 OPERATION_NOT_ALLOWED", async () => {
    await createDomain("locked.com");
    await sendJson(
      "/domains/locked.com",
      { clientStatuses: { add: ["clientRenewProhibited"] } },
      "PATCH",
    );
    const res = await sendJson("/domains/locked.com/renew", { period: 1 });
    expect(res.status).toBe(409);
    const body = await parseError(res);
    expect(body.error.code).toBe("OPERATION_NOT_ALLOWED");
    const details = body.error.details as { statuses: string[] };
    expect(details.statuses).toContain("clientRenewProhibited");
  });

  it("period 欠落は 400 VALIDATION_ERROR", async () => {
    await createDomain("noperiod.com");
    const res = await sendJson("/domains/noperiod.com/renew", {});
    expect(res.status).toBe(400);
    expect((await parseError(res)).error.code).toBe("VALIDATION_ERROR");
  });
});

describe("PATCH /api/v1/domains/:name（FR-09 情報修正）", () => {
  it("NS 全量指定が add/rem 差分に変換される", async () => {
    await createDomain("ns.com");
    const first = await sendJson(
      "/domains/ns.com",
      { nameservers: ["ns1.example.com", "ns2.example.com"] },
      "PATCH",
    );
    expect(first.status).toBe(200);
    const { domain: afterFirst } = (await first.json()) as DomainPayload;
    expect(afterFirst?.statuses).not.toContain("inactive");

    // ns2 → ns3 への入れ替え = add: [ns3], rem: [ns2] になるはず
    const second = await sendJson(
      "/domains/ns.com",
      { nameservers: ["ns1.example.com", "ns3.example.com"] },
      "PATCH",
    );
    const { domain } = (await second.json()) as DomainPayload;
    expect(domain?.nameservers?.toSorted()).toEqual([
      "ns1.example.com",
      "ns3.example.com",
    ]);
  });

  it("NS を全解除すると inactive に戻る", async () => {
    await createDomain("clear.com");
    await sendJson(
      "/domains/clear.com",
      { nameservers: ["ns1.example.com", "ns2.example.com"] },
      "PATCH",
    );
    const res = await sendJson(
      "/domains/clear.com",
      { nameservers: [] },
      "PATCH",
    );
    const { domain } = (await res.json()) as DomainPayload;
    expect(domain?.nameservers).toEqual([]);
    expect(domain?.statuses).toContain("inactive");
  });

  it("差分なしの要求は現状をそのまま返す（no-op）", async () => {
    await createDomain("noop.com");
    const res = await sendJson(
      "/domains/noop.com",
      { clientStatuses: {} },
      "PATCH",
    );
    expect(res.status).toBe(200);
    const { domain } = (await res.json()) as DomainPayload;
    expect(domain?.name).toBe("noop.com");
  });

  it("clientUpdateProhibited 中の変更は 409、ロック解除だけは通る", async () => {
    await createDomain("uplock.com");
    await sendJson(
      "/domains/uplock.com",
      { clientStatuses: { add: ["clientUpdateProhibited"] } },
      "PATCH",
    );

    const blocked = await sendJson(
      "/domains/uplock.com",
      { nameservers: ["ns1.example.com", "ns2.example.com"] },
      "PATCH",
    );
    expect(blocked.status).toBe(409);
    expect((await parseError(blocked)).error.code).toBe(
      "OPERATION_NOT_ALLOWED",
    );

    // 解除経路（unlockOnly）は clientUpdateProhibited 中でも許可される
    const unlock = await sendJson(
      "/domains/uplock.com",
      { clientStatuses: { remove: ["clientUpdateProhibited"] } },
      "PATCH",
    );
    expect(unlock.status).toBe(200);
    const { domain } = (await unlock.json()) as DomainPayload;
    expect(domain?.statuses).not.toContain("clientUpdateProhibited");
  });

  it("変更内容が空のボディは 400 VALIDATION_ERROR", async () => {
    await createDomain("empty.com");
    const res = await sendJson("/domains/empty.com", {}, "PATCH");
    expect(res.status).toBe(400);
    expect((await parseError(res)).error.code).toBe("VALIDATION_ERROR");
  });
});

describe("DELETE / restore（FR-10 / FR-11）", () => {
  it("廃止すると RGP（redemptionPeriod）に入る", async () => {
    await createDomain("del.com");
    const res = await api("/domains/del.com", { method: "DELETE" });
    expect(res.status).toBe(200);
    const { domain } = (await res.json()) as DomainPayload;
    expect(domain?.statuses).toContain("pendingDelete");
    expect(domain?.rgpStatuses).toContain("redemptionPeriod");
  });

  it("AC-10-2: clientDeleteProhibited 中は廃止できない", async () => {
    await createDomain("dellock.com");
    await sendJson(
      "/domains/dellock.com",
      { clientStatuses: { add: ["clientDeleteProhibited"] } },
      "PATCH",
    );
    const res = await api("/domains/dellock.com", { method: "DELETE" });
    expect(res.status).toBe(409);
    expect((await parseError(res)).error.code).toBe("OPERATION_NOT_ALLOWED");
  });

  it("AC-11-2: RGP 中は復旧でき、RGP 外は 409", async () => {
    await createDomain("res.com");
    const early = await api("/domains/res.com/restore", { method: "POST" });
    expect(early.status).toBe(409);
    expect((await parseError(early)).error.code).toBe("OPERATION_NOT_ALLOWED");

    await api("/domains/res.com", { method: "DELETE" });
    const res = await api("/domains/res.com/restore", { method: "POST" });
    expect(res.status).toBe(200);
    const { domain } = (await res.json()) as DomainPayload;
    expect(domain?.statuses).not.toContain("pendingDelete");
    expect(domain?.rgpStatuses).not.toContain("redemptionPeriod");
  });
});

describe("GET /api/v1/domains/:name/auth-code（FR-12 移管 OUT）", () => {
  it("AuthCode を返し、取得のたびにローテートされる", async () => {
    await createDomain("auth.com");
    const first = await api("/domains/auth.com/auth-code");
    expect(first.status).toBe(200);
    const a = (await first.json()) as { authCode: string; rotated: boolean };
    expect(a.rotated).toBe(true);
    expect(a.authCode.length).toBeGreaterThan(0);
    expect(a.authCode.length).toBeLessThanOrEqual(64);

    const second = await api("/domains/auth.com/auth-code");
    const b = (await second.json()) as { authCode: string };
    expect(b.authCode).not.toBe(a.authCode);
  });
});

describe("AC-06-2 / AC-18-2: 更新系タイムアウト時の info 照合", () => {
  let adapter: TimeoutMockAdapter;

  beforeEach(() => {
    adapter = new TimeoutMockAdapter("kitaqsign");
    setRegistrySetForTesting(
      createRegistrySet({ mode: "real", adapters: [adapter] }),
    );
  });

  it("create: レジストリ側で登録が成立していれば 201 を返す（AC-06-2）", async () => {
    adapter.timeoutMode = "after-success";
    const res = await sendJson("/domains", { name: "slow.com", period: 1 });
    expect(res.status).toBe(201);
    const { domain } = (await res.json()) as DomainPayload;
    expect(domain?.name).toBe("slow.com");
    expect(domain?.rgpStatuses).toContain("addPeriod");
  });

  it("create: レジストリに届いていなければ 504 REGISTRY_TIMEOUT のまま", async () => {
    adapter.timeoutMode = "before-reach";
    const res = await sendJson("/domains", { name: "lost.com", period: 1 });
    expect(res.status).toBe(504);
    expect((await parseError(res)).error.code).toBe("REGISTRY_TIMEOUT");
  });

  it("renew: 期限延長が反映されていれば 200 を返す", async () => {
    const { domain: before } = await createDomain("slowrenew.com");
    adapter.timeoutMode = "after-success";
    const res = await sendJson("/domains/slowrenew.com/renew", { period: 1 });
    expect(res.status).toBe(200);
    const { domain } = (await res.json()) as DomainPayload;
    expect(new Date(domain?.expiresAt ?? 0).getTime()).toBeGreaterThan(
      new Date(before?.expiresAt ?? 0).getTime(),
    );
  });

  it("renew: 反映が確認できなければ 504 REGISTRY_TIMEOUT のまま", async () => {
    await createDomain("lostrenew.com");
    adapter.timeoutMode = "before-reach";
    const res = await sendJson("/domains/lostrenew.com/renew", { period: 1 });
    expect(res.status).toBe(504);
    expect((await parseError(res)).error.code).toBe("REGISTRY_TIMEOUT");
  });

  it("update: NS 変更が反映されていれば 200 を返す", async () => {
    await createDomain("slowns.com");
    adapter.timeoutMode = "after-success";
    const res = await sendJson(
      "/domains/slowns.com",
      { nameservers: ["ns1.example.com", "ns2.example.com"] },
      "PATCH",
    );
    expect(res.status).toBe(200);
    const { domain } = (await res.json()) as DomainPayload;
    expect(domain?.nameservers?.toSorted()).toEqual([
      "ns1.example.com",
      "ns2.example.com",
    ]);
  });

  it("update: status が反映されなくても NS 変更を確認できれば 200 を返す", async () => {
    await createDomain("slownsstatus.com");
    adapter.ignoreStatusUpdates = true;
    adapter.timeoutMode = "after-success";
    const res = await sendJson(
      "/domains/slownsstatus.com",
      {
        nameservers: ["ns1.example.com", "ns2.example.com"],
        clientStatuses: { add: ["clientRenewProhibited"] },
      },
      "PATCH",
    );
    expect(res.status).toBe(200);
    const { domain } = (await res.json()) as DomainPayload;
    expect(domain?.nameservers?.toSorted()).toEqual([
      "ns1.example.com",
      "ns2.example.com",
    ]);
    expect(domain?.statuses).not.toContain("clientRenewProhibited");
  });

  it("update: status 変更だけのタイムアウトは照合不能なため 504 のまま", async () => {
    await createDomain("slowstatus.com");
    adapter.ignoreStatusUpdates = true;
    adapter.timeoutMode = "after-success";
    const res = await sendJson(
      "/domains/slowstatus.com",
      { clientStatuses: { add: ["clientRenewProhibited"] } },
      "PATCH",
    );
    expect(res.status).toBe(504);
    expect((await parseError(res)).error.code).toBe("REGISTRY_TIMEOUT");
  });

  it("update: 反映が確認できなければ 504 REGISTRY_TIMEOUT のまま", async () => {
    await createDomain("lostns.com");
    adapter.timeoutMode = "before-reach";
    const res = await sendJson(
      "/domains/lostns.com",
      { nameservers: ["ns1.example.com", "ns2.example.com"] },
      "PATCH",
    );
    expect(res.status).toBe(504);
    expect((await parseError(res)).error.code).toBe("REGISTRY_TIMEOUT");
  });

  it("delete: 廃止が反映されていれば 200 で RGP 状態を返す", async () => {
    await createDomain("slowdel.com");
    adapter.timeoutMode = "after-success";
    const res = await api("/domains/slowdel.com", { method: "DELETE" });
    expect(res.status).toBe(200);
    const { domain } = (await res.json()) as DomainPayload;
    expect(domain?.rgpStatuses).toContain("redemptionPeriod");
  });

  it("restore: 復旧が反映されていれば 200 を返す", async () => {
    await createDomain("slowres.com");
    await api("/domains/slowres.com", { method: "DELETE" });
    adapter.timeoutMode = "after-success";
    const res = await api("/domains/slowres.com/restore", { method: "POST" });
    expect(res.status).toBe(200);
    const { domain } = (await res.json()) as DomainPayload;
    expect(domain?.rgpStatuses).not.toContain("redemptionPeriod");
  });
});

describe("エラー変換（§10.3: RegistryError → 統一エラー形式）", () => {
  function installThrowingAdapter(err: unknown): void {
    const fail = (): never => {
      throw err;
    };
    const stub: RegistryAdapter = {
      id: "kitaqsign",
      specVersion: "stub",
      hello: async () => fail(),
      check: async () => fail(),
      info: async () => fail(),
      create: async () => fail(),
      renew: async () => fail(),
      update: async () => fail(),
      delete: async () => fail(),
      restore: async () => fail(),
      transferRequest: async () => fail(),
      transferQuery: async () => fail(),
      authCode: async () => fail(),
    };
    setRegistrySetForTesting(
      createRegistrySet({ mode: "real", adapters: [stub] }),
    );
  }

  const CASES: Array<{
    code: RegistryErrorCode;
    status: number;
    retryable: boolean;
  }> = [
    { code: "NOT_FOUND", status: 404, retryable: false },
    { code: "CONFLICT", status: 409, retryable: false },
    { code: "OPERATION_NOT_ALLOWED", status: 409, retryable: false },
    { code: "REGISTRY_REJECTED", status: 422, retryable: false },
    { code: "REGISTRY_TIMEOUT", status: 504, retryable: true },
    { code: "REGISTRY_UNAVAILABLE", status: 502, retryable: true },
    { code: "REGISTRY_SPEC_MISMATCH", status: 502, retryable: false },
  ];

  it.each(CASES)(
    "$code は HTTP $status / retryable=$retryable になり、生テキストを漏らさない",
    async ({ code, status, retryable }) => {
      installThrowingAdapter(
        new RegistryError({
          code,
          registry: "kitaqsign",
          message: "RAW-REGISTRY-MESSAGE",
          reason: "RAW-REGISTRY-REASON",
          registryCode: 2400,
        }),
      );
      const res = await api("/domains/foo.com");
      expect(res.status).toBe(status);
      const text = await res.text();
      const body = apiErrorBodySchema.parse(JSON.parse(text));
      expect(body.error).toMatchObject({
        code,
        retryable,
        registry: "kitaqsign",
        registryCode: "2400",
      });
      expect(body.error.requestId).toBeTruthy();
      // レジストリの生 message / reason はログ限定（UI に出さない）
      expect(text).not.toContain("RAW-REGISTRY-MESSAGE");
      expect(text).not.toContain("RAW-REGISTRY-REASON");
    },
  );

  it("想定外の例外は 500 INTERNAL（詳細を漏らさない・NFR-06）", async () => {
    installThrowingAdapter(new Error("boom-secret-detail"));
    const res = await api("/domains/foo.com");
    expect(res.status).toBe(500);
    const text = await res.text();
    const body = apiErrorBodySchema.parse(JSON.parse(text));
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.requestId).toBeTruthy();
    expect(text).not.toContain("boom-secret-detail");
  });

  it("エラー本文の requestId は x-request-id ヘッダと一致する", async () => {
    const res = await api("/domains/ghost.com");
    const body = await parseError(res);
    expect(body.error.requestId).toBe(res.headers.get("x-request-id"));
  });
});
