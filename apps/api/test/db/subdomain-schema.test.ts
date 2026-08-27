import { type Db, schema } from "@dopamin/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, resetTestDb } from "../helpers/db";

/**
 * subdomain_plans / dns_records（docs/requirements.md §9.1 / FR-13）のスキーマ制約を
 * pglite で検証する。ON DELETE CASCADE と UNIQUE はマイグレーション
 * （packages/db/drizzle）でしか表現されないので、DDL を実際に当てて確かめる。
 */

let db: Db;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
}, 30_000);

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await resetTestDb(db);
});

/** drizzle は DB エラーを包んで投げるので cause を辿って全文を集める */
function errorText(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join(" / ");
}

async function insertDomain(name = "demo.com"): Promise<string> {
  const users = await db
    .insert(schema.users)
    .values({ displayName: "サブドメイン設計テスト" })
    .returning({ id: schema.users.id });
  const userId = users[0]?.id;
  if (userId === undefined) throw new Error("users の INSERT に失敗した");
  const rows = await db
    .insert(schema.domains)
    .values({
      userId,
      name,
      sld: name.split(".")[0] ?? name,
      tld: name.split(".")[1] ?? "com",
      registry: "mock",
      statuses: ["ok"],
    })
    .returning({ id: schema.domains.id });
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("domains の INSERT に失敗した");
  return id;
}

describe("subdomain_plans スキーマ（§9.1）", () => {
  it("§9.1 の列をすべて往復でき、未反映は applied_at が NULL", async () => {
    const domainId = await insertDomain();

    await db.insert(schema.subdomainPlans).values({
      domainId,
      repoUrl: "https://github.com/dopamin/demo",
      repoSummary: { languages: ["TypeScript"], hints: ["apps/"] },
      proposal: {
        policy: "www を入口にし、API とドキュメントを分ける",
        items: [
          {
            host: "www",
            purpose: "ランディングページ",
            recordType: "CNAME",
            target: "cname.vercel-dns.com",
            priority: "required",
          },
        ],
      },
    });

    const rows = await db
      .select()
      .from(schema.subdomainPlans)
      .where(eq(schema.subdomainPlans.domainId, domainId));
    const row = rows[0];
    expect(row?.repoUrl).toBe("https://github.com/dopamin/demo");
    expect(row?.repoSummary).toEqual({
      languages: ["TypeScript"],
      hints: ["apps/"],
    });
    expect(row?.proposal).toMatchObject({
      policy: "www を入口にし、API とドキュメントを分ける",
    });
    expect(row?.updatedAt).toBeInstanceOf(Date);
    // 保存しただけでは DNS は変わらない（FR-13）
    expect(row?.appliedAt).toBeNull();
  });

  it("1 ドメインにつき 1 件だけ（UNIQUE(domain_id)）", async () => {
    const domainId = await insertDomain();
    const values = { domainId, proposal: { policy: "p", items: [] } };
    await db.insert(schema.subdomainPlans).values(values);

    const error = await db
      .insert(schema.subdomainPlans)
      .values(values)
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect(errorText(error)).toContain("subdomain_plans_domain_id_uniq");
    expect(await db.$count(schema.subdomainPlans)).toBe(1);
  });

  it("domains を削除すると設計も消える（ON DELETE CASCADE）", async () => {
    const domainId = await insertDomain();
    await db
      .insert(schema.subdomainPlans)
      .values({ domainId, proposal: { policy: "p", items: [] } });

    await db.delete(schema.domains).where(eq(schema.domains.id, domainId));

    expect(await db.$count(schema.subdomainPlans)).toBe(0);
  });
});

describe("dns_records スキーマ（§9.1）", () => {
  it("ttl の既定は 3600 で、§9.1 の列を往復できる", async () => {
    const domainId = await insertDomain();

    await db.insert(schema.dnsRecords).values({
      domainId,
      host: "www",
      recordType: "CNAME",
      target: "cname.vercel-dns.com",
      source: "subdomain_plan",
      appliedAt: new Date("2026-08-27T00:00:00.000Z"),
    });

    const rows = await db.select().from(schema.dnsRecords);
    expect(rows[0]).toMatchObject({
      host: "www",
      recordType: "CNAME",
      target: "cname.vercel-dns.com",
      ttl: 3600,
      source: "subdomain_plan",
    });
    expect(rows[0]?.appliedAt).toBeInstanceOf(Date);
  });

  it("同じ (domain_id, host, record_type) は 1 件だけ", async () => {
    const domainId = await insertDomain();
    const values = {
      domainId,
      host: "www",
      recordType: "CNAME",
      target: "cname.vercel-dns.com",
      source: "subdomain_plan",
      appliedAt: new Date(),
    };
    await db.insert(schema.dnsRecords).values(values);

    const error = await db
      .insert(schema.dnsRecords)
      .values({ ...values, target: "other.example.com" })
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect(errorText(error)).toContain(
      "dns_records_domain_id_host_record_type_uniq",
    );
    expect(await db.$count(schema.dnsRecords)).toBe(1);
  });

  it("同じホストでもレコード種別が違えば入る", async () => {
    const domainId = await insertDomain();
    const base = {
      domainId,
      host: "www",
      source: "subdomain_plan",
      appliedAt: new Date(),
    };
    await db
      .insert(schema.dnsRecords)
      .values({ ...base, recordType: "CNAME", target: "cname.vercel-dns.com" });
    await db
      .insert(schema.dnsRecords)
      .values({ ...base, recordType: "A", target: "203.0.113.10" });

    expect(await db.$count(schema.dnsRecords)).toBe(2);
  });

  it("domains を削除するとレコードも消える（ON DELETE CASCADE）", async () => {
    const domainId = await insertDomain();
    await db.insert(schema.dnsRecords).values({
      domainId,
      host: "@",
      recordType: "A",
      target: "203.0.113.10",
      source: "subdomain_plan",
      appliedAt: new Date(),
    });

    await db.delete(schema.domains).where(eq(schema.domains.id, domainId));

    expect(await db.$count(schema.dnsRecords)).toBe(0);
  });
});
