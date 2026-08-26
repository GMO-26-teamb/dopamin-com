import { type Db, schema } from "@dopamin/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestDb, resetTestDb } from "./db";

/** packages/db/drizzle の 3 マイグレーションが作るテーブル */
const EXPECTED_TABLES = [
  "contacts",
  "domains",
  "operation_logs",
  "passkey_credentials",
  "sessions",
  "transfers",
  "users",
  "webauthn_challenges",
];

// Db 型は execute の結果を unknown にするので zod で形を確認する
const tableRowsSchema = z.object({
  rows: z.array(z.object({ table_name: z.string() })),
});

let db: Db;
let closeDb: (() => Promise<void>) | undefined;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
}, 30_000);

afterAll(async () => {
  // beforeAll が timeout した場合は未代入。ここで TypeError を出すと本来の原因を隠すので省略可能にする
  await closeDb?.();
});

describe("createTestDb", () => {
  it("packages/db/drizzle のマイグレーションを journal 順に全部適用している", async () => {
    const result = await db.execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const { rows } = tableRowsSchema.parse(result);
    expect(rows.map((r) => r.table_name)).toEqual(EXPECTED_TABLES);
  });

  it("gen_random_uuid() / now() の既定値が pglite でも効く", async () => {
    const rows = await db
      .insert(schema.users)
      .values({ displayName: "たくたく" })
      .returning();
    const user = rows[0];
    expect(user?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(user?.createdAt).toBeInstanceOf(Date);
  });

  it("bytea は Uint8Array、bigint は number で往復する", async () => {
    const users = await db
      .insert(schema.users)
      .values({ displayName: "bytea" })
      .returning({ id: schema.users.id });
    const userId = users[0]?.id ?? "";
    await db.insert(schema.passkeyCredentials).values({
      id: "cred-bytea",
      userId,
      publicKey: new Uint8Array([1, 2, 3]),
      counter: 42,
      transports: ["internal"],
    });
    const rows = await db
      .select()
      .from(schema.passkeyCredentials)
      .where(sql`${schema.passkeyCredentials.id} = 'cred-bytea'`);
    expect(Array.from(rows[0]?.publicKey ?? [])).toEqual([1, 2, 3]);
    expect(rows[0]?.counter).toBe(42);
    expect(rows[0]?.transports).toEqual(["internal"]);
  });

  it("resetTestDb で全テーブルが空になる（FK 先も CASCADE で消える）", async () => {
    const users = await db
      .insert(schema.users)
      .values({ displayName: "消える人" })
      .returning({ id: schema.users.id });
    const userId = users[0]?.id ?? "";
    await db.insert(schema.sessions).values({
      id: "sess-reset",
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await db.insert(schema.webauthnChallenges).values({
      challenge: "c",
      type: "authentication",
      expiresAt: new Date(Date.now() + 60_000),
    });

    await resetTestDb(db);

    expect(await db.$count(schema.users)).toBe(0);
    expect(await db.$count(schema.sessions)).toBe(0);
    expect(await db.$count(schema.passkeyCredentials)).toBe(0);
    expect(await db.$count(schema.webauthnChallenges)).toBe(0);
  });
});
