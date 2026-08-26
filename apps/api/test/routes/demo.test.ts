import { type Db, DEMO_DOMAIN_PREFIX, schema } from "@dopamin/db";
import type { DemoResetResponse } from "@dopamin/shared";
import { demoResetResponseSchema } from "@dopamin/shared";
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
import { createTestDb, resetTestDb } from "../helpers/db";
import { createTestSession } from "../helpers/session";

/**
 * POST /demo/reset（docs/requirements.md FR-16 / AC-16-1・AC-16-2）の統合テスト。
 * mock レジストリを環境変数から本番と同じ配線で組み立てる。
 */

let db: Db;
let closeDb: () => Promise<void>;

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
  process.env.DEMO_RESET_ENABLED = "true";
  resetApiEnvCacheForTesting();
  setRegistrySetForTesting(null);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  setRegistrySetForTesting(null);
  delete process.env.DEMO_RESET_ENABLED;
  resetApiEnvCacheForTesting();
  vi.restoreAllMocks();
});

async function reset(cookie: string): Promise<{
  status: number;
  json: unknown;
}> {
  const res = await app.request("/api/v1/demo/reset", {
    method: "POST",
    headers: { cookie },
  });
  return { status: res.status, json: await res.json() };
}

async function selectDomains(userId: string) {
  return db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.userId, userId));
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe("POST /demo/reset（FR-16）", () => {
  it("AC-16-2: 4 状態 + 移管 IN / OUT のデモデータを投入する", async () => {
    const { user, cookie } = await createTestSession(db);

    const { status, json } = await reset(cookie);
    const body = json as DemoResetResponse;

    expect(status).toBe(200);
    expect(demoResetResponseSchema.safeParse(body).success).toBe(true);
    expect(body.ok).toBe(true);
    expect(body.domains).toHaveLength(5);
    for (const name of body.domains) {
      expect(name.startsWith(DEMO_DOMAIN_PREFIX)).toBe(true);
    }

    // 移管 IN は domains 行を作らない（§6.5）ので保有行は 4 件
    const domains = await selectDomains(user.id);
    expect(domains).toHaveLength(4);

    const byScenario = (scenario: string) =>
      domains.find((row) => row.name.includes(`-${scenario}.`));

    // Active
    expect(byScenario("active")?.statuses).toEqual(["ok"]);

    // RGP（redemptionPeriod + 残日数）
    const rgp = byScenario("rgp");
    expect(rgp?.rgpStatus).toBe("redemptionPeriod");
    const rgpUntil = rgp?.rgpUntil;
    expect(rgpUntil).toBeInstanceOf(Date);
    expect((rgpUntil ?? new Date(0)).getTime()).toBeGreaterThan(Date.now());

    // 期限間近（20 日後）
    const expiresAt = byScenario("expiring")?.expiresAt;
    expect(expiresAt).toBeInstanceOf(Date);
    const daysLeft =
      ((expiresAt ?? new Date(0)).getTime() - Date.now()) / DAY_MS;
    expect(daysLeft).toBeGreaterThan(18);
    expect(daysLeft).toBeLessThan(22);

    // 移管 OUT は保有行が pendingTransfer になる
    expect(byScenario("transfer-out")?.statuses).toContain("pendingTransfer");
  });

  it("移管は IN / OUT が 1 件ずつ pending で入る", async () => {
    const { user, cookie } = await createTestSession(db);
    await reset(cookie);

    const transfers = await db
      .select()
      .from(schema.transfers)
      .where(eq(schema.transfers.userId, user.id));

    expect(transfers).toHaveLength(2);
    const inbound = transfers.find((row) => row.direction === "in");
    const outbound = transfers.find((row) => row.direction === "out");
    expect(inbound).toMatchObject({ status: "pending", registry: "mock" });
    expect(outbound).toMatchObject({ status: "pending", registry: "mock" });
    // 自動承認の期限が入っている（§9.2 transferAutoApproveAt）
    expect(inbound?.actByAt).toBeInstanceOf(Date);
  });

  it("既存のドメイン・設計・ログを消してから投入する", async () => {
    const { user, cookie } = await createTestSession(db);
    const domains = await db
      .insert(schema.domains)
      .values({
        userId: user.id,
        name: "old.com",
        sld: "old",
        tld: "com",
        registry: "mock",
        statuses: ["ok"],
        syncedAt: new Date(),
      })
      .returning({ id: schema.domains.id });
    const domainId = domains[0]?.id ?? "";
    await db
      .insert(schema.subdomainPlans)
      .values({ domainId, proposal: { policy: "p", items: [] } });
    await db.insert(schema.dnsRecords).values({
      domainId,
      host: "www",
      recordType: "CNAME",
      target: "old.example.com",
      source: "subdomain_plan",
      appliedAt: new Date(),
    });
    await db.insert(schema.aiLogs).values({
      userId: user.id,
      feature: "domain_candidates",
      provider: "google",
      model: "gemini-2.5-flash",
      status: "success",
    });

    await reset(cookie);

    const names = (await selectDomains(user.id)).map((row) => row.name);
    expect(names).not.toContain("old.com");
    // domains の CASCADE で設計とレコードも消える
    expect(await db.$count(schema.subdomainPlans)).toBe(0);
    expect(await db.$count(schema.dnsRecords)).toBe(0);
    expect(await db.$count(schema.aiLogs)).toBe(0);
  });

  it("他ユーザーのデータは消さない", async () => {
    const other = await createTestSession(db, { displayName: "別の人" });
    await db.insert(schema.domains).values({
      userId: other.user.id,
      name: "keep.com",
      sld: "keep",
      tld: "com",
      registry: "mock",
      statuses: ["ok"],
      syncedAt: new Date(),
    });
    const { cookie } = await createTestSession(db);

    await reset(cookie);

    expect((await selectDomains(other.user.id)).map((row) => row.name)).toEqual(
      ["keep.com"],
    );
  });

  it("2 回続けて実行できる（前回のデモ用ドメインを掃除する）", async () => {
    const { user, cookie } = await createTestSession(db);
    const first = (await reset(cookie)).json as DemoResetResponse;
    const second = await reset(cookie);
    const body = second.json as DemoResetResponse;

    expect(second.status).toBe(200);
    expect(body.domains).toHaveLength(5);
    // 毎回ランダムな接尾辞になるので名前は変わる
    expect(body.domains).not.toEqual(first.domains);
    expect(await selectDomains(user.id)).toHaveLength(4);
  });

  it("AC-16-1: DEMO_RESET_ENABLED が false なら 404", async () => {
    const { cookie } = await createTestSession(db);
    process.env.DEMO_RESET_ENABLED = "false";
    resetApiEnvCacheForTesting();

    const { status, json } = await reset(cookie);

    expect(status).toBe(404);
    expect((json as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });

  it("DEMO_RESET_ENABLED が未設定でも 404", async () => {
    const { cookie } = await createTestSession(db);
    delete process.env.DEMO_RESET_ENABLED;
    resetApiEnvCacheForTesting();

    expect((await reset(cookie)).status).toBe(404);
  });

  it("REGISTRY_MODE=real では投入できない（実レジストリに登録しない）", async () => {
    const { cookie } = await createTestSession(db);
    process.env.REGISTRY_MODE = "real";
    process.env.KITAQSIGN_BASE_URL = "https://epp.example.invalid";
    process.env.KITAQSIGN_GATE_USER = "u";
    process.env.KITAQSIGN_GATE_PASSWORD = "p";
    process.env.KITAQSIGN_REGISTRAR_ID = "r";
    process.env.KITAQSIGN_API_KEY = "k";
    resetApiEnvCacheForTesting();
    setRegistrySetForTesting(null);

    const { status } = await reset(cookie);
    expect(status).toBe(409);

    for (const key of [
      "KITAQSIGN_BASE_URL",
      "KITAQSIGN_GATE_USER",
      "KITAQSIGN_GATE_PASSWORD",
      "KITAQSIGN_REGISTRAR_ID",
      "KITAQSIGN_API_KEY",
    ]) {
      delete process.env[key];
    }
    process.env.REGISTRY_MODE = "mock";
    resetApiEnvCacheForTesting();
  });

  it("未認証は 401", async () => {
    const res = await app.request("/api/v1/demo/reset", { method: "POST" });
    expect(res.status).toBe(401);
  });
});
