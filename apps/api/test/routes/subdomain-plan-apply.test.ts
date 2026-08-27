import { type Db, schema } from "@dopamin/db";
import {
  createRegistrySet,
  MockRegistryAdapter,
  RegistryError,
} from "@dopamin/registry";
import type {
  DnsZoneResponse,
  DomainInfo,
  SubdomainPlanApplyResponse,
  SubdomainPlanResponse,
  SubdomainPlanSummary,
  UpdateInput,
} from "@dopamin/shared";
import {
  DOPAMIN_NAMESERVERS,
  dnsZoneResponseSchema,
  domainDetailResponseSchema,
  subdomainPlanApplyResponseSchema,
} from "@dopamin/shared";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import app from "../../src/index";
import { setDbForTesting } from "../../src/lib/db";
import { resetApiEnvCacheForTesting } from "../../src/lib/env";
import { setRegistrySetForTesting } from "../../src/lib/registries";
import { setRetrySleepForTesting } from "../../src/lib/retry";
import { createTestDb, resetTestDb } from "../helpers/db";
import { createTestSession } from "../helpers/session";

/**
 * POST /domains/:name/subdomain-plan/apply と GET /domains/:name/dns
 * （docs/requirements.md FR-13 / AC-13-4・AC-13-5・AC-13-7）の統合テスト。
 *
 * レジストリは環境変数から mock を配線するので、NS 切替は本番と同じ
 * `adapter.update` の経路を通る。
 */

/**
 * 参照系（`info`）は成功し、NS 切替の `update` だけ失敗するアダプタ（#165）。
 *
 * `MOCK_REGISTRY_FAIL_MODE=reject` は `MockRegistryAdapter` の `gate()` が
 * 参照系にも効くため、`switchNameserversIfNeeded` 先頭の `adapter.info` で
 * その場で落ち、NS 切替（`adapter.update`）に一度も到達しない。
 * AC-13-5 は「切替に失敗したらレコードを触らない」なので、読みと書きを
 * 分けられるここで `update` だけを落とす。
 */
class RejectUpdateAdapter extends MockRegistryAdapter {
  /** true の間だけ `update` を拒否する（ドメイン登録は成功させたいので既定は false）。 */
  rejectUpdate = false;

  override update(name: string, input: UpdateInput): Promise<DomainInfo> {
    if (!this.rejectUpdate) {
      return super.update(name, input);
    }
    return Promise.reject(
      new RegistryError({
        code: "REGISTRY_REJECTED",
        registry: this.id,
        message: `update: ${name} のネームサーバ変更を拒否しました（テスト用シミュレーション）`,
        registryCode: 2306,
        command: "update",
      }),
    );
  }
}

let db: Db;
let closeDb: () => Promise<void>;

const WWW = {
  host: "www",
  purpose: "ランディングページ",
  recordType: "CNAME" as const,
  target: "cname.vercel-dns.com",
  priority: "required" as const,
};
const API = {
  host: "api",
  purpose: "REST API",
  recordType: "CNAME" as const,
  target: "api.vercel-dns.com",
  priority: "recommended" as const,
};

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
  setDbForTesting(db);
}, 30_000);

afterAll(async () => {
  setDbForTesting(null);
  await closeDb();
});

beforeEach(async () => {
  await resetTestDb(db);
  setDbForTesting(db);
  process.env.REGISTRY_MODE = "mock";
  delete process.env.MOCK_REGISTRY_FAIL_MODE;
  resetApiEnvCacheForTesting();
  setRegistrySetForTesting(null);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  setRetrySleepForTesting(null);
  setRegistrySetForTesting(null);
  delete process.env.MOCK_REGISTRY_FAIL_MODE;
  resetApiEnvCacheForTesting();
  vi.restoreAllMocks();
});

/** mock レジストリに実在するドメインを作り、DB にも保有行を入れる。 */
async function registerDomain(
  cookie: string,
  name: string,
  nameservers?: string[],
): Promise<void> {
  const res = await app.request("/api/v1/domains", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      name,
      period: 1,
      ...(nameservers ? { nameservers } : {}),
    }),
  });
  if (res.status !== 201) {
    throw new Error(`ドメイン登録に失敗した: ${res.status}`);
  }
}

async function savePlan(
  cookie: string,
  name: string,
  items: unknown[],
): Promise<SubdomainPlanResponse> {
  const res = await app.request(`/api/v1/domains/${name}/subdomain-plan`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ policy: "www を入口にする", items }),
  });
  return (await res.json()) as SubdomainPlanResponse;
}

async function apply(
  cookie: string,
  name: string,
): Promise<{ status: number; json: unknown }> {
  const res = await app.request(
    `/api/v1/domains/${name}/subdomain-plan/apply`,
    { method: "POST", headers: { cookie } },
  );
  return { status: res.status, json: await res.json() };
}

async function getDns(
  cookie: string,
  name: string,
): Promise<{ status: number; json: unknown }> {
  const res = await app.request(`/api/v1/domains/${name}/dns`, {
    headers: { cookie },
  });
  return { status: res.status, json: await res.json() };
}

async function selectRecords(domainName: string) {
  const domains = await db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.name, domainName));
  const domainId = domains[0]?.id ?? "";
  return db
    .select()
    .from(schema.dnsRecords)
    .where(eq(schema.dnsRecords.domainId, domainId));
}

describe("POST /domains/:name/subdomain-plan/apply（FR-13）", () => {
  it("AC-13-4: 初回反映でレコードが作られ、バッジが反映済みになる", async () => {
    const { cookie } = await createTestSession(db);
    await registerDomain(cookie, "apply1.com", [...DOPAMIN_NAMESERVERS]);
    await savePlan(cookie, "apply1.com", [WWW, API]);

    const { status, json } = await apply(cookie, "apply1.com");
    const body = json as SubdomainPlanApplyResponse;

    expect(status).toBe(200);
    expect(subdomainPlanApplyResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({
      added: 2,
      updated: 0,
      removed: 0,
      // 登録時からドパ民 DNS なので切替は起きない
      nameserversChanged: false,
    });

    const records = await selectRecords("apply1.com");
    expect(records.map((r) => r.host).sort()).toEqual(["api", "www"]);
    expect(records[0]?.source).toBe("subdomain_plan");

    // 設計を取り直すと全ホストが applied になる
    const planRes = await app.request(
      "/api/v1/domains/apply1.com/subdomain-plan",
      { headers: { cookie } },
    );
    const plan = (await planRes.json()) as SubdomainPlanResponse;
    expect(plan.items.every((i) => i.applyState === "applied")).toBe(true);
    expect(plan.appliedAt).not.toBeNull();
  });

  it("AC-13-4: 反映後の GET /dns は設計と一致し、差分が空になる", async () => {
    const { cookie } = await createTestSession(db);
    await registerDomain(cookie, "apply2.com", [...DOPAMIN_NAMESERVERS]);
    await savePlan(cookie, "apply2.com", [WWW, API]);
    await apply(cookie, "apply2.com");

    const { status, json } = await getDns(cookie, "apply2.com");
    const body = json as DnsZoneResponse;

    expect(status).toBe(200);
    expect(dnsZoneResponseSchema.safeParse(body).success).toBe(true);
    expect(body.records.map((r) => r.host)).toEqual(["api", "www"]);
    expect(body.diff.added).toEqual([]);
    expect(body.diff.changed).toEqual([]);
    expect(body.diff.removed).toEqual([]);
    expect(body.diff.unchanged).toHaveLength(2);
  });

  it("再反映は差分ぶんだけ動く（変更 / 削除）", async () => {
    const { cookie } = await createTestSession(db);
    await registerDomain(cookie, "apply3.com", [...DOPAMIN_NAMESERVERS]);
    await savePlan(cookie, "apply3.com", [WWW, API]);
    await apply(cookie, "apply3.com");

    // www の向き先を変え、api を設計から外す
    await savePlan(cookie, "apply3.com", [
      { ...WWW, target: "moved.vercel-dns.com" },
    ]);
    const { json } = await apply(cookie, "apply3.com");

    expect(json).toMatchObject({ added: 0, updated: 1, removed: 1 });
    const records = await selectRecords("apply3.com");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      host: "www",
      target: "moved.vercel-dns.com",
    });
  });

  it("AC-13-4: recordType を変えて再反映しても旧種別の行が残らない", async () => {
    const { cookie } = await createTestSession(db);
    await registerDomain(cookie, "apply10.com", [...DOPAMIN_NAMESERVERS]);
    await savePlan(cookie, "apply10.com", [WWW]);
    await apply(cookie, "apply10.com");

    // www を CNAME → A に切り替える（upsert の競合キーが record_type を含むため、
    // 新種別の行が INSERT されるだけで旧種別の行が削除されず残る回帰があった）
    await savePlan(cookie, "apply10.com", [
      { ...WWW, recordType: "A" as const, target: "203.0.113.10" },
    ]);
    const { json } = await apply(cookie, "apply10.com");
    expect(json).toMatchObject({ added: 0, updated: 1, removed: 0 });

    const records = await selectRecords("apply10.com");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      host: "www",
      recordType: "A",
      target: "203.0.113.10",
    });

    // 反映直後の GET /dns は設計と一致し、差分が空になる（AC-13-4）
    const { json: dns } = await getDns(cookie, "apply10.com");
    const zone = dns as DnsZoneResponse;
    expect(zone.diff.added).toEqual([]);
    expect(zone.diff.changed).toEqual([]);
    expect(zone.diff.removed).toEqual([]);
  });

  it("AC-13-6: 反映 → 編集 → 再反映で applied に戻る", async () => {
    const { cookie } = await createTestSession(db);
    await registerDomain(cookie, "apply4.com", [...DOPAMIN_NAMESERVERS]);
    await savePlan(cookie, "apply4.com", [WWW]);
    await apply(cookie, "apply4.com");

    const edited = await savePlan(cookie, "apply4.com", [
      { ...WWW, target: "edited.vercel-dns.com" },
    ]);
    expect(edited.items[0]?.applyState).toBe("changed");

    await apply(cookie, "apply4.com");
    const res = await app.request("/api/v1/domains/apply4.com/subdomain-plan", {
      headers: { cookie },
    });
    const plan = (await res.json()) as SubdomainPlanResponse;
    expect(plan.items[0]?.applyState).toBe("applied");
  });

  it("AC-13-5: NS がドパ民 DNS でなければ切り替える", async () => {
    const { cookie } = await createTestSession(db);
    await registerDomain(cookie, "apply5.com", [
      "ns1.example.com",
      "ns2.example.com",
    ]);
    await savePlan(cookie, "apply5.com", [WWW]);

    const { json } = await apply(cookie, "apply5.com");
    expect(json).toMatchObject({ added: 1, nameserversChanged: true });

    // レコードは実際に作られる（切替が成功したときだけ書き込む）
    expect(await selectRecords("apply5.com")).toHaveLength(1);

    // spec §2.4: NS 切替のレジストリ呼び出しは `update` として別行で残る
    // （反映そのものの `subdomain_plan.apply` と混ぜない）
    const logs = await db.select().from(schema.operationLogs);
    const applyLogs = logs.filter(
      (row) =>
        row.command === "subdomain_plan.apply" &&
        row.domainName === "apply5.com",
    );
    const updateLogs = logs.filter(
      (row) => row.command === "update" && row.domainName === "apply5.com",
    );
    expect(applyLogs).toHaveLength(1);
    expect(updateLogs).toHaveLength(1);
    expect(updateLogs[0]).toMatchObject({
      registry: "mock",
      status: "success",
      errorCode: null,
    });

    // info で確認できる（AC-09-1 準拠）
    const detail = await app.request("/api/v1/domains/apply5.com", {
      headers: { cookie },
    });
    const body = (await detail.json()) as {
      domain: { nameservers: string[] };
    };
    expect([...body.domain.nameservers].sort()).toEqual(
      [...DOPAMIN_NAMESERVERS].sort(),
    );
  });

  it("AC-13-5: NS 切替（adapter.update）が失敗したらレコードを 1 件も変更しない", async () => {
    // errorHandler が RegistryError を構造化ログに出すので、出力を汚さない
    vi.spyOn(console, "error").mockImplementation(() => {});
    const adapter = new RejectUpdateAdapter();
    setRegistrySetForTesting(
      createRegistrySet({ mode: "mock", adapters: [adapter] }),
    );
    setRetrySleepForTesting(() => Promise.resolve());

    const { cookie } = await createTestSession(db);
    await registerDomain(cookie, "apply6.com", [
      "ns1.example.com",
      "ns2.example.com",
    ]);
    await savePlan(cookie, "apply6.com", [WWW]);

    // ここから update（= NS 切替）だけが失敗する。info は成功するので
    // switchNameserversIfNeeded は実際に切替を試みるところまで進む
    adapter.rejectUpdate = true;

    const { status, json } = await apply(cookie, "apply6.com");

    // §10.3 の写像を固定する（500 に化けたら気づけるように）
    expect(status).toBe(422);
    expect((json as { error: { code: string } }).error.code).toBe(
      "REGISTRY_REJECTED",
    );
    expect(await selectRecords("apply6.com")).toHaveLength(0);

    // 失敗しても applied_at は進まない
    const domains = await db
      .select()
      .from(schema.domains)
      .where(eq(schema.domains.name, "apply6.com"));
    const plans = await db
      .select()
      .from(schema.subdomainPlans)
      .where(eq(schema.subdomainPlans.domainId, domains[0]?.id ?? ""));
    expect(plans[0]?.appliedAt).toBeNull();

    // 反映の失敗は操作ログに残る（AC-15-1）
    const applyLog = (await db.select().from(schema.operationLogs)).find(
      (row) =>
        row.command === "subdomain_plan.apply" &&
        row.domainName === "apply6.com",
    );
    expect(applyLog).toMatchObject({
      status: "error",
      errorCode: "REGISTRY_REJECTED",
    });
    expect(applyLog?.response).toMatchObject({ nameserversChanged: false });
  });

  it("反映は操作ログに subdomain_plan.apply として残り、AI ログには残らない", async () => {
    const { user, cookie } = await createTestSession(db);
    await registerDomain(cookie, "apply7.com", [...DOPAMIN_NAMESERVERS]);
    await savePlan(cookie, "apply7.com", [WWW]);
    await apply(cookie, "apply7.com");

    const logs = await db.select().from(schema.operationLogs);
    const applyLog = logs.find((row) => row.command === "subdomain_plan.apply");
    expect(applyLog).toMatchObject({
      userId: user.id,
      registry: "mock",
      domainName: "apply7.com",
      status: "success",
      errorCode: null,
    });
    expect(applyLog?.response).toMatchObject({
      added: 1,
      nameserversChanged: false,
    });
    // 反映は AI 呼び出しを伴わない
    expect(await db.$count(schema.aiLogs)).toBe(0);
  });

  it("設計が保存されていなければ 404", async () => {
    const { cookie } = await createTestSession(db);
    await registerDomain(cookie, "apply8.com", [...DOPAMIN_NAMESERVERS]);

    const { status, json } = await apply(cookie, "apply8.com");

    expect(status).toBe(404);
    expect((json as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });

  it("他ユーザーのドメインは 403（NFR-04）", async () => {
    const owner = await createTestSession(db, { displayName: "所有者" });
    const other = await createTestSession(db, { displayName: "別の人" });
    await registerDomain(owner.cookie, "apply9.com", [...DOPAMIN_NAMESERVERS]);
    await savePlan(owner.cookie, "apply9.com", [WWW]);

    expect((await apply(other.cookie, "apply9.com")).status).toBe(403);
  });

  it("未認証は 401", async () => {
    const res = await app.request(
      "/api/v1/domains/demo.com/subdomain-plan/apply",
      { method: "POST" },
    );
    expect(res.status).toBe(401);
  });
});

describe("GET /domains/:name/dns（FR-13）", () => {
  it("AC-13-7: 未反映の設計は差分（追加）として見える", async () => {
    const { cookie } = await createTestSession(db);
    await registerDomain(cookie, "dns1.com", [...DOPAMIN_NAMESERVERS]);
    await savePlan(cookie, "dns1.com", [WWW, API]);

    const { json } = await getDns(cookie, "dns1.com");
    const body = json as DnsZoneResponse;

    expect(body.records).toEqual([]);
    expect(body.diff.added.map((r) => r.host).sort()).toEqual(["api", "www"]);
    expect(body.diff.removed).toEqual([]);
  });

  it("設計が無ければレコードだけを返し、差分は空（全消し扱いにしない）", async () => {
    const { cookie } = await createTestSession(db);
    await registerDomain(cookie, "dns2.com", [...DOPAMIN_NAMESERVERS]);

    const { status, json } = await getDns(cookie, "dns2.com");
    const body = json as DnsZoneResponse;

    expect(status).toBe(200);
    expect(body.records).toEqual([]);
    expect(body.diff).toEqual({
      added: [],
      changed: [],
      removed: [],
      unchanged: [],
    });
  });

  it("他ユーザーのドメインは 403（NFR-04）", async () => {
    const owner = await createTestSession(db, { displayName: "所有者" });
    const other = await createTestSession(db, { displayName: "別の人" });
    await registerDomain(owner.cookie, "dns3.com", [...DOPAMIN_NAMESERVERS]);

    expect((await getDns(other.cookie, "dns3.com")).status).toBe(403);
  });

  it("未認証は 401", async () => {
    const res = await app.request("/api/v1/domains/demo.com/dns");
    expect(res.status).toBe(401);
  });
});

describe("GET /domains/:name のサブドメイン設計の件数（FR-07 / #217）", () => {
  async function detailPlan(
    cookie: string,
    name: string,
  ): Promise<SubdomainPlanSummary | null> {
    const res = await app.request(`/api/v1/domains/${name}`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    return domainDetailResponseSchema.parse(await res.json()).subdomainPlan;
  }

  it("設計が無ければ null（詳細カードは「未作成」を出す）", async () => {
    const { cookie } = await createTestSession(db);
    await registerDomain(cookie, "count1.com", [...DOPAMIN_NAMESERVERS]);

    expect(await detailPlan(cookie, "count1.com")).toBeNull();
  });

  it("保存しただけならホスト数が入り、反映済みは 0", async () => {
    const { cookie } = await createTestSession(db);
    await registerDomain(cookie, "count2.com", [...DOPAMIN_NAMESERVERS]);
    await savePlan(cookie, "count2.com", [WWW, API]);

    expect(await detailPlan(cookie, "count2.com")).toEqual({
      hosts: 2,
      applied: 0,
    });
  });

  it("反映すると applied が増え、編集したホストは applied から外れる（AC-13-6）", async () => {
    const { cookie } = await createTestSession(db);
    await registerDomain(cookie, "count3.com", [...DOPAMIN_NAMESERVERS]);
    await savePlan(cookie, "count3.com", [WWW, API]);
    await apply(cookie, "count3.com");

    expect(await detailPlan(cookie, "count3.com")).toEqual({
      hosts: 2,
      applied: 2,
    });

    // 反映後に www の向き先だけ変えると、そのホストは changed に倒れる
    await savePlan(cookie, "count3.com", [
      { ...WWW, target: "moved.vercel-dns.com" },
      API,
    ]);
    expect(await detailPlan(cookie, "count3.com")).toEqual({
      hosts: 2,
      applied: 1,
    });
  });
});
