import { type Db, schema } from "@dopamin/db";
import type { SubdomainPlanResponse } from "@dopamin/shared";
import { subdomainPlanResponseSchema } from "@dopamin/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../../src/index";
import { setDbForTesting } from "../../src/lib/db";
import { createTestDb, resetTestDb } from "../helpers/db";
import { createTestSession } from "../helpers/session";

/**
 * PUT / GET /domains/:name/subdomain-plan（docs/requirements.md FR-13 /
 * AC-13-3・AC-13-6）の統合テスト。AI も GitHub も使わない経路。
 */

let db: Db;
let closeDb: () => Promise<void>;

const PLAN = {
  repoUrl: "https://github.com/dopamin/demo",
  policy: "www を入口にし、API を分ける",
  items: [
    {
      host: "www",
      purpose: "ランディングページ",
      recordType: "CNAME" as const,
      target: "cname.vercel-dns.com",
      priority: "required" as const,
    },
    {
      host: "api",
      purpose: "REST API",
      recordType: "CNAME" as const,
      target: "api.vercel-dns.com",
      priority: "recommended" as const,
    },
  ],
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
});

async function seedDomain(userId: string, name = "demo.com"): Promise<string> {
  const rows = await db
    .insert(schema.domains)
    .values({
      userId,
      name,
      sld: name.split(".")[0] ?? name,
      tld: name.split(".")[1] ?? "com",
      registry: "mock",
      statuses: ["ok"],
      syncedAt: new Date(),
    })
    .returning({ id: schema.domains.id });
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("domains の INSERT に失敗した");
  return id;
}

/** 疑似 DNS ゾーンに 1 件反映済みの状態を作る。 */
async function seedDnsRecord(
  domainId: string,
  values: { host: string; recordType: string; target: string },
): Promise<void> {
  await db.insert(schema.dnsRecords).values({
    domainId,
    ...values,
    ttl: 3600,
    source: "subdomain_plan",
    appliedAt: new Date("2026-08-27T00:00:00.000Z"),
  });
}

async function put(
  name: string,
  body: unknown,
  cookie: string,
): Promise<{ status: number; json: unknown }> {
  const res = await app.request(`/api/v1/domains/${name}/subdomain-plan`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

async function get(
  name: string,
  cookie: string,
): Promise<{ status: number; json: unknown }> {
  const res = await app.request(`/api/v1/domains/${name}/subdomain-plan`, {
    headers: { cookie },
  });
  return { status: res.status, json: await res.json() };
}

describe("PUT /domains/:name/subdomain-plan（FR-13）", () => {
  it("保存すると契約どおりの応答を返し、行が 1 件入る", async () => {
    const { user, cookie } = await createTestSession(db);
    await seedDomain(user.id);

    const { status, json } = await put("demo.com", PLAN, cookie);
    const body = json as SubdomainPlanResponse;

    expect(status).toBe(200);
    expect(subdomainPlanResponseSchema.safeParse(body).success).toBe(true);
    expect(body.domain).toBe("demo.com");
    expect(body.repoUrl).toBe(PLAN.repoUrl);
    expect(body.items.map((i) => i.host)).toEqual(["www", "api"]);
    // 保存しただけでは DNS は変わらない
    expect(body.appliedAt).toBeNull();
    expect(body.items.every((i) => i.applyState === "unapplied")).toBe(true);
    expect(await db.$count(schema.subdomainPlans)).toBe(1);
  });

  it("外部 DNS 用の手順テキストを含む（FR-13 手動設定）", async () => {
    const { user, cookie } = await createTestSession(db);
    await seedDomain(user.id);

    const { json } = await put("demo.com", PLAN, cookie);
    const body = json as SubdomainPlanResponse;

    expect(body.instructions).toContain("www.demo.com（必須）");
    expect(body.instructions).toContain("cname.vercel-dns.com");
    expect(body.instructions).toContain("api.demo.com（推奨）");
  });

  it("2 回目の保存は upsert（行は増えず updated_at が進む）", async () => {
    const { user, cookie } = await createTestSession(db);
    const domainId = await seedDomain(user.id);

    const first = await put("demo.com", PLAN, cookie);
    const firstSavedAt = (first.json as SubdomainPlanResponse).savedAt;
    const second = await put(
      "demo.com",
      { ...PLAN, policy: "方針を変えた" },
      cookie,
    );
    const body = second.json as SubdomainPlanResponse;

    expect(await db.$count(schema.subdomainPlans)).toBe(1);
    expect(body.policy).toBe("方針を変えた");
    expect(new Date(body.savedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(firstSavedAt).getTime(),
    );
    const rows = await db
      .select()
      .from(schema.subdomainPlans)
      .where(eq(schema.subdomainPlans.domainId, domainId));
    expect(rows[0]?.proposal).toMatchObject({ policy: "方針を変えた" });
  });

  it("AC-13-6: 反映済みホストの内容を変えて保存すると changed になる", async () => {
    const { user, cookie } = await createTestSession(db);
    const domainId = await seedDomain(user.id);
    // www は反映済み、api は未反映
    await seedDnsRecord(domainId, {
      host: "www",
      recordType: "CNAME",
      target: "cname.vercel-dns.com",
    });

    const applied = await put("demo.com", PLAN, cookie);
    expect(
      (applied.json as SubdomainPlanResponse).items.map((i) => i.applyState),
    ).toEqual(["applied", "unapplied"]);

    const edited = await put(
      "demo.com",
      {
        ...PLAN,
        items: [
          { ...PLAN.items[0], target: "changed.vercel-dns.com" },
          PLAN.items[1],
        ],
      },
      cookie,
    );

    expect(
      (edited.json as SubdomainPlanResponse).items.map((i) => i.applyState),
    ).toEqual(["changed", "unapplied"]);
  });

  it("既に反映済みなら appliedAt は保存で消えない", async () => {
    const { user, cookie } = await createTestSession(db);
    const domainId = await seedDomain(user.id);
    await put("demo.com", PLAN, cookie);
    const appliedAt = new Date("2026-08-27T01:00:00.000Z");
    await db
      .update(schema.subdomainPlans)
      .set({ appliedAt })
      .where(eq(schema.subdomainPlans.domainId, domainId));

    const { json } = await put(
      "demo.com",
      { ...PLAN, policy: "再編集" },
      cookie,
    );

    expect((json as SubdomainPlanResponse).appliedAt).toBe(
      appliedAt.toISOString(),
    );
  });

  it("ホストが重複する設計は VALIDATION_ERROR（400）", async () => {
    const { user, cookie } = await createTestSession(db);
    await seedDomain(user.id);

    const { status } = await put(
      "demo.com",
      { ...PLAN, items: [PLAN.items[0], { ...PLAN.items[1], host: "www" }] },
      cookie,
    );

    expect(status).toBe(400);
  });

  it("A レコードにホスト名を指定すると VALIDATION_ERROR（400）", async () => {
    const { user, cookie } = await createTestSession(db);
    await seedDomain(user.id);

    const { status } = await put(
      "demo.com",
      {
        ...PLAN,
        items: [{ ...PLAN.items[0], recordType: "A", target: "example.com" }],
      },
      cookie,
    );

    expect(status).toBe(400);
  });

  it("空の items は VALIDATION_ERROR（400）", async () => {
    const { user, cookie } = await createTestSession(db);
    await seedDomain(user.id);

    const { status } = await put("demo.com", { ...PLAN, items: [] }, cookie);

    expect(status).toBe(400);
  });

  it("他ユーザーのドメインは 403、保有していなければ 404（NFR-04）", async () => {
    const owner = await createTestSession(db, { displayName: "所有者" });
    const { cookie } = await createTestSession(db, { displayName: "別の人" });
    await seedDomain(owner.user.id, "other.com");

    expect((await put("other.com", PLAN, cookie)).status).toBe(403);
    expect((await put("nobody.com", PLAN, cookie)).status).toBe(404);
  });

  it("未認証は 401", async () => {
    const res = await app.request("/api/v1/domains/demo.com/subdomain-plan", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(PLAN),
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /domains/:name/subdomain-plan（FR-13）", () => {
  it("AC-13-3: 保存 → 再取得できる", async () => {
    const { user, cookie } = await createTestSession(db);
    await seedDomain(user.id);
    await put("demo.com", PLAN, cookie);

    const { status, json } = await get("demo.com", cookie);
    const body = json as SubdomainPlanResponse;

    expect(status).toBe(200);
    expect(subdomainPlanResponseSchema.safeParse(body).success).toBe(true);
    expect(body.policy).toBe(PLAN.policy);
    expect(body.items).toHaveLength(2);
    expect(body.instructions).toContain("demo.com のサブドメイン設定手順");
  });

  it("反映状態は疑似 DNS ゾーンとの突き合わせで毎回導出する", async () => {
    const { user, cookie } = await createTestSession(db);
    const domainId = await seedDomain(user.id);
    await put("demo.com", PLAN, cookie);

    // 保存後にゾーン側だけが変わっても、取得のたびに正しい状態になる
    await seedDnsRecord(domainId, {
      host: "api",
      recordType: "CNAME",
      target: "api.vercel-dns.com",
    });

    const { json } = await get("demo.com", cookie);
    expect(
      (json as SubdomainPlanResponse).items.map((i) => i.applyState),
    ).toEqual(["unapplied", "applied"]);
  });

  it("保存していなければ 404", async () => {
    const { user, cookie } = await createTestSession(db);
    await seedDomain(user.id);

    const { status, json } = await get("demo.com", cookie);

    expect(status).toBe(404);
    expect((json as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });

  it("他ユーザーのドメインは 403（NFR-04）", async () => {
    const owner = await createTestSession(db, { displayName: "所有者" });
    const { cookie } = await createTestSession(db, { displayName: "別の人" });
    await seedDomain(owner.user.id, "other.com");

    expect((await get("other.com", cookie)).status).toBe(403);
  });

  it("未認証は 401", async () => {
    const res = await app.request("/api/v1/domains/demo.com/subdomain-plan");
    expect(res.status).toBe(401);
  });
});
