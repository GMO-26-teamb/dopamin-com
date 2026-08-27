import { type Db, schema } from "@dopamin/db";
import { passkeySummarySchema } from "@dopamin/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../../src/index";
import { setDbForTesting } from "../../src/lib/db";
import { createTestDb } from "../helpers/db";
import { createTestSession } from "../helpers/session";

/**
 * PATCH /auth/passkeys/:id の統合テスト（FR-01 spec §3.4 / §9）。
 * A0 のテスト DB（pglite + packages/db/drizzle のマイグレーション）にユーザー 2 人と
 * パスキーを INSERT し、requireSession → zod → サービスを本番と同じ経路で通す。
 */

let db: Db;
let close: (() => Promise<void>) | undefined;
let alice: Awaited<ReturnType<typeof createTestSession>>;
let bob: Awaited<ReturnType<typeof createTestSession>>;

const ALICE_CRED = "cred-alice-1";
const BOB_CRED = "cred-bob-1";

beforeAll(async () => {
  // env() は遅延評価。DB は setDbForTesting で注入するので DATABASE_URL はダミーでよい
  process.env.DATABASE_URL = "postgres://unused:unused@localhost:1/unused";
  process.env.WEBAUTHN_RP_ID = "localhost";
  process.env.WEBAUTHN_ORIGIN = "http://localhost:3000";

  ({ db, close } = await createTestDb());
  setDbForTesting(db);
  alice = await createTestSession(db, { displayName: "alice" });
  bob = await createTestSession(db, { displayName: "bob" });
  await db.insert(schema.passkeyCredentials).values([
    {
      id: ALICE_CRED,
      userId: alice.user.id,
      publicKey: Buffer.from([1, 2, 3]),
      counter: 0,
      deviceType: "multiDevice",
      backedUp: true,
      aaguid: "fbfc3007-154e-4ecc-8c0b-6e020557d7bd",
      name: "iCloud キーチェーン",
    },
    {
      id: BOB_CRED,
      userId: bob.user.id,
      publicKey: Buffer.from([4, 5, 6]),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      aaguid: "00000000-0000-0000-0000-000000000000",
      name: "このデバイス",
    },
  ]);
}, 30_000);

afterAll(async () => {
  setDbForTesting(null);
  // beforeAll が timeout した場合は未代入。ここで TypeError を出すと本来の原因を隠すので省略可能にする
  await close?.();
});

async function patch(
  id: string,
  body: unknown,
  cookie?: string,
): Promise<Response> {
  return await app.request(`/api/v1/auth/passkeys/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: JSON.stringify(body),
  });
}

async function nameInDb(id: string): Promise<string | null | undefined> {
  const rows = await db
    .select({ name: schema.passkeyCredentials.name })
    .from(schema.passkeyCredentials)
    .where(eq(schema.passkeyCredentials.id, id));
  return rows[0]?.name;
}

describe("PATCH /api/v1/auth/passkeys/:id", () => {
  it("自分のパスキーの名前を変更し、更新後の PasskeySummary を返す", async () => {
    const res = await patch(
      ALICE_CRED,
      { name: "仕事用 MacBook" },
      alice.cookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { passkey: unknown };
    const passkey = passkeySummarySchema.parse(body.passkey);
    expect(passkey).toMatchObject({
      id: ALICE_CRED,
      name: "仕事用 MacBook",
      deviceType: "multiDevice",
      backedUp: true,
      lastUsedAt: null,
    });
    await expect(nameInDb(ALICE_CRED)).resolves.toBe("仕事用 MacBook");
  });

  it("前後の空白は除去して保存する", async () => {
    const res = await patch(
      ALICE_CRED,
      { name: "  自宅の PC  " },
      alice.cookie,
    );
    expect(res.status).toBe(200);
    await expect(nameInDb(ALICE_CRED)).resolves.toBe("自宅の PC");
  });

  it("変更後の名前が GET /auth/passkeys に反映される", async () => {
    await patch(ALICE_CRED, { name: "一覧で見る名前" }, alice.cookie);
    const res = await app.request("/api/v1/auth/passkeys", {
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      passkeys: Array<{ id: string; name: string | null }>;
    };
    expect(body.passkeys).toHaveLength(1);
    expect(body.passkeys[0]).toMatchObject({
      id: ALICE_CRED,
      name: "一覧で見る名前",
    });
  });

  it("他人のパスキーは 404 NOT_FOUND で、名前も変わらない", async () => {
    const before = await nameInDb(ALICE_CRED);
    const res = await patch(ALICE_CRED, { name: "乗っ取り" }, bob.cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    await expect(nameInDb(ALICE_CRED)).resolves.toBe(before);
  });

  it("存在しない ID は 404 NOT_FOUND", async () => {
    const res = await patch("no-such-credential", { name: "x" }, alice.cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it.each([
    ["0 文字", ""],
    ["33 文字", "あ".repeat(33)],
    ["空白のみ", "   "],
  ])(
    "%s は 400 VALIDATION_ERROR（details に issue の配列が付く）",
    async (_label, name) => {
      const res = await patch(ALICE_CRED, { name }, alice.cookie);
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; details?: unknown };
      };
      expect(body.error.code).toBe("VALIDATION_ERROR");
      // §10.3: VALIDATION_ERROR の details は issue の配列（#141 で全ルート統一）
      expect(body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: expect.any(String),
            message: expect.any(String),
          }),
        ]),
      );
    },
  );

  it("name が無いボディは 400 VALIDATION_ERROR", async () => {
    const res = await patch(ALICE_CRED, {}, alice.cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("未認証は 401 UNAUTHORIZED（AC-01-3）", async () => {
    const res = await patch(ALICE_CRED, { name: "x" });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });
});

/**
 * このユーザーのパスキーを count 件（<prefix>-0 …）作り、セッション Cookie を返す。
 * 既存の describe と行を共有しないよう、テストごとに新しいユーザーを作る。
 */
async function seedUserWithPasskeys(
  prefix: string,
  count: number,
): Promise<{ userId: string; cookie: string; ids: string[] }> {
  const session = await createTestSession(db, { displayName: prefix });
  const ids = Array.from({ length: count }, (_, i) => `${prefix}-${i}`);
  await db.insert(schema.passkeyCredentials).values(
    ids.map((id, i) => ({
      id,
      userId: session.user.id,
      publicKey: Buffer.from([i + 1]),
      counter: 0,
      name: `パスキー ${i}`,
    })),
  );
  return { userId: session.user.id, cookie: session.cookie, ids };
}

/**
 * #221: 一覧の並びを API が保証する（作成日昇順 → id 昇順）。
 * orderBy が無いと Postgres のプラン任せになり、UPDATE された行が末尾へ飛ぶ。
 */
describe("GET /api/v1/auth/passkeys の並び順（#221）", () => {
  async function listIds(cookie: string): Promise<string[]> {
    const res = await app.request("/api/v1/auth/passkeys", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { passkeys: Array<{ id: string }> };
    return body.passkeys.map((p) => p.id);
  }

  it("名前を変更しても一覧の並びが変わらない", async () => {
    const { cookie, ids } = await seedUserWithPasskeys("order", 3);
    // pglite は統計が無いと索引経由のプランになり症状が出ない。本番と同じ Seq Scan を選ばせる
    await db.execute(sql`ANALYZE "passkey_credentials"`);
    const before = await listIds(cookie);
    expect(before).toEqual(ids);

    const target = ids[0] ?? "";
    expect((await patch(target, { name: "編集した名前" }, cookie)).status).toBe(
      200,
    );

    expect(await listIds(cookie)).toEqual(before);
  });

  it("ログイン（counter / last_used_at の更新）でも並びが変わらない", async () => {
    const { cookie, ids } = await seedUserWithPasskeys("order-login", 3);
    await db.execute(sql`ANALYZE "passkey_credentials"`);
    const before = await listIds(cookie);

    await db
      .update(schema.passkeyCredentials)
      .set({ counter: 1, lastUsedAt: new Date() })
      .where(eq(schema.passkeyCredentials.id, ids[0] ?? ""));

    expect(await listIds(cookie)).toEqual(before);
  });
});
