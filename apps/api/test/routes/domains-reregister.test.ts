import { type Db, schema } from "@dopamin/db";
import { createRegistrySet, MockRegistryAdapter } from "@dopamin/registry";
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
import { setRegistrySetForTesting } from "../../src/lib/registries";
import { setRetrySleepForTesting } from "../../src/lib/retry";
import { createTestDb, resetTestDb } from "../helpers/db";
import { createTestSession } from "../helpers/session";

/**
 * #222 / NFR-04 / §6.5: 一度誰かが保有していた名前を、別のユーザーが後から登録する経路。
 *
 * `domains` 行はレジストリから消えても残る（`syncDomains` は NOT_FOUND で行を消さず、
 * RGP に入った行は `DELETE /domains/:name` でも `owned` のまま残る）。
 * §11.4 の通常ライフサイクル（廃止 → RGP → Pending Delete → レジストリから消滅）を
 * 経た全ドメインがこの「残存行」になるので、これは例外状況ではなく通常の終着状態。
 *
 * この状態で `POST /domains` が同じ行の `user_id` だけを書き換えると、
 * `domain_id` に紐付く `subdomain_plans` / `dns_records` / `transfers` がまるごと
 * 新しい所有者のものになり、旧所有者の非公開リポジトリ URL・設計・DNS レコードが
 * 無関係のユーザーに読める。ここではその経路を本番と同じルートで踏む。
 *
 * この 1 ファイルだけ DB 実装の DomainStore をそのまま使う（`domains.id` に紐付く
 * 子テーブルまで見たいので、インメモリ store の seam では再現できない）。
 */

const DOMAIN = "leak.com"; // .com → kitaqsign（§11.2）

/** 旧所有者が保存する設計。repoUrl は「他人に見えてはいけない値」の代表として使う。 */
const B_PLAN = {
  repoUrl: "https://github.com/b-user/secret-repo",
  policy: "B の設計",
  items: [
    {
      host: "www",
      purpose: "ランディングページ",
      recordType: "CNAME" as const,
      target: "b-secret.vercel-dns.com",
      priority: "required" as const,
    },
  ],
};

let db: Db;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  process.env.DATABASE_URL = "postgres://unused:unused@localhost:1/unused";
  process.env.WEBAUTHN_RP_ID = "localhost";
  process.env.WEBAUTHN_ORIGIN = "http://localhost:3000";
  ({ db, close: closeDb } = await createTestDb());
  setDbForTesting(db);
}, 30_000);

afterAll(async () => {
  setDbForTesting(null);
  await closeDb();
});

beforeEach(async () => {
  await resetTestDb(db);
  setRetrySleepForTesting(() => Promise.resolve());
  freshRegistry();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  setRetrySleepForTesting(null);
  setRegistrySetForTesting(null);
  vi.restoreAllMocks();
});

/**
 * レジストリを新品に差し替える。「RGP 経過後に purge されて名前が空いた」状態を
 * mock で作る手段（アダプタは状態をインスタンス内に持つ）。
 */
function freshRegistry(): void {
  setRegistrySetForTesting(
    createRegistrySet({
      mode: "real",
      adapters: [
        new MockRegistryAdapter({ id: "kitaqsign" }),
        new MockRegistryAdapter({ id: "kitaqnic" }),
      ],
    }),
  );
}

async function request(
  path: string,
  cookie: string,
  init: RequestInit = {},
): Promise<Response> {
  return await app.request(`/api/v1${path}`, {
    ...init,
    headers: { cookie, ...init.headers },
  });
}

function sendJson(
  path: string,
  cookie: string,
  body: unknown,
  method = "POST",
): Promise<Response> {
  return request(path, cookie, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function domainRows() {
  return await db
    .select({
      id: schema.domains.id,
      userId: schema.domains.userId,
      ownership: schema.domains.ownership,
    })
    .from(schema.domains)
    .where(eq(schema.domains.name, DOMAIN));
}

/** 旧所有者 B: 登録 → 設計を保存 → DNS へ反映済み、まで作る。 */
async function seedPreviousOwner(): Promise<{
  cookie: string;
  userId: string;
  domainId: string;
}> {
  const b = await createTestSession(db, { displayName: "旧所有者 B" });
  expect(
    (await sendJson("/domains", b.cookie, { name: DOMAIN, period: 1 })).status,
  ).toBe(201);
  expect(
    (
      await sendJson(
        `/domains/${DOMAIN}/subdomain-plan`,
        b.cookie,
        B_PLAN,
        "PUT",
      )
    ).status,
  ).toBe(200);

  const rows = await domainRows();
  const domainId = rows[0]?.id;
  if (domainId === undefined) {
    throw new Error("B の domains 行が作られていない");
  }
  // apply 相当（疑似 DNS ゾーンに反映済みのレコード）
  await db.insert(schema.dnsRecords).values({
    domainId,
    host: "www",
    recordType: "CNAME",
    target: "b-secret.vercel-dns.com",
    ttl: 3600,
    source: "subdomain_plan",
    appliedAt: new Date("2026-08-27T00:00:00.000Z"),
  });
  // 移管履歴（domain_id は ON DELETE SET NULL の任意参照）
  await db.insert(schema.transfers).values({
    userId: b.user.id,
    domainId,
    domainName: DOMAIN,
    registry: "kitaqsign",
    direction: "out",
    status: "cancelled",
  });
  return { cookie: b.cookie, userId: b.user.id, domainId };
}

describe("POST /api/v1/domains: 別ユーザーの残存行がある名前の登録（#222）", () => {
  it("旧所有者の行を乗っ取らず、新しい id の行を作る", async () => {
    const previous = await seedPreviousOwner();
    // レジストリから消えて名前が空いた（DB の行は残ったまま）
    freshRegistry();
    const a = await createTestSession(db, { displayName: "新所有者 A" });

    const res = await sendJson("/domains", a.cookie, {
      name: DOMAIN,
      period: 1,
    });

    expect(res.status).toBe(201);
    const owned = (await domainRows()).filter((r) => r.ownership === "owned");
    expect(owned).toHaveLength(1);
    expect(owned[0]?.userId).toBe(a.user.id);
    expect(owned[0]?.id).not.toBe(previous.domainId);
  });

  it("旧所有者のサブドメイン設計・DNS レコードを引き継がない（AC-13-3）", async () => {
    const previous = await seedPreviousOwner();
    freshRegistry();
    const a = await createTestSession(db, { displayName: "新所有者 A" });
    await sendJson("/domains", a.cookie, { name: DOMAIN, period: 1 });

    const plan = await request(`/domains/${DOMAIN}/subdomain-plan`, a.cookie);
    expect(plan.status).toBe(404);
    const dns = await request(`/domains/${DOMAIN}/dns`, a.cookie);
    expect(dns.status).toBe(200);
    expect(await dns.json()).toMatchObject({ records: [] });

    // 旧所有者の行そのものが残っていないこと（残っていれば別の名前で読めてしまう）
    expect(
      await db.$count(
        schema.subdomainPlans,
        eq(schema.subdomainPlans.domainId, previous.domainId),
      ),
    ).toBe(0);
    expect(
      await db.$count(
        schema.dnsRecords,
        eq(schema.dnsRecords.domainId, previous.domainId),
      ),
    ).toBe(0);
  });

  it("旧所有者の transfers.domain_id が新所有者の行を指さない", async () => {
    await seedPreviousOwner();
    freshRegistry();
    const a = await createTestSession(db, { displayName: "新所有者 A" });
    await sendJson("/domains", a.cookie, { name: DOMAIN, period: 1 });

    const owned = (await domainRows()).filter((r) => r.ownership === "owned");
    const transfers = await db
      .select({ domainId: schema.transfers.domainId })
      .from(schema.transfers);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]?.domainId).not.toBe(owned[0]?.id);
  });

  it("旧所有者はそのドメインを読めない（403 FORBIDDEN。NFR-04）", async () => {
    const previous = await seedPreviousOwner();
    freshRegistry();
    const a = await createTestSession(db, { displayName: "新所有者 A" });
    await sendJson("/domains", a.cookie, { name: DOMAIN, period: 1 });

    const res = await request(`/domains/${DOMAIN}`, previous.cookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("同一ユーザーの再取得では設計を引き継ぐ（従来どおり）", async () => {
    const previous = await seedPreviousOwner();
    freshRegistry();

    const res = await sendJson("/domains", previous.cookie, {
      name: DOMAIN,
      period: 1,
    });

    expect(res.status).toBe(201);
    const owned = (await domainRows()).filter((r) => r.ownership === "owned");
    expect(owned).toHaveLength(1);
    expect(owned[0]?.id).toBe(previous.domainId);
    const plan = await request(
      `/domains/${DOMAIN}/subdomain-plan`,
      previous.cookie,
    );
    expect(plan.status).toBe(200);
    expect(await plan.json()).toMatchObject({ repoUrl: B_PLAN.repoUrl });
  });
});
