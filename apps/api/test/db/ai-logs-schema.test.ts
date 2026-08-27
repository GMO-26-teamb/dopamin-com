import { type Db, schema } from "@dopamin/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, resetTestDb } from "../helpers/db";

/**
 * ai_logs（docs/requirements.md §9.1 / FR-14）のスキーマ制約を pglite で検証する。
 * user_id の ON DELETE CASCADE と NOT NULL 制約はマイグレーション（packages/db/drizzle）
 * でしか表現されないので、DDL を実際に当てて確かめる。
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

async function insertUser(): Promise<string> {
  const rows = await db
    .insert(schema.users)
    .values({ displayName: "AI ログテスト" })
    .returning({ id: schema.users.id });
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("users の INSERT に失敗した");
  return id;
}

describe("ai_logs スキーマ（§9.1）", () => {
  it("§9.1 の列をすべて往復できる", async () => {
    const userId = await insertUser();

    await db.insert(schema.aiLogs).values({
      userId,
      feature: "domain_candidates",
      provider: "google",
      model: "gemini-2.5-flash",
      inputSummary: "ニックネーム: どぱみん / 除外: dopamin.com",
      output: {
        candidates: [{ name: "dopamin.dev", reason: "短くて覚えやすい" }],
      },
      tokensIn: 320,
      tokensOut: 128,
      latencyMs: 1_234,
      status: "success",
    });

    const rows = await db
      .select()
      .from(schema.aiLogs)
      .where(eq(schema.aiLogs.userId, userId));
    const row = rows[0];
    expect(row?.feature).toBe("domain_candidates");
    expect(row?.provider).toBe("google");
    expect(row?.model).toBe("gemini-2.5-flash");
    expect(row?.inputSummary).toBe(
      "ニックネーム: どぱみん / 除外: dopamin.com",
    );
    expect(row?.output).toEqual({
      candidates: [{ name: "dopamin.dev", reason: "短くて覚えやすい" }],
    });
    expect(row?.tokensIn).toBe(320);
    expect(row?.tokensOut).toBe(128);
    expect(row?.latencyMs).toBe(1_234);
    expect(row?.status).toBe("success");
    expect(row?.errorMessage).toBeNull();
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  it("失敗ログは output・トークンが NULL でも入る（AC-14-1 は成功・失敗とも記録する）", async () => {
    const userId = await insertUser();

    await db.insert(schema.aiLogs).values({
      userId,
      feature: "uniqueness",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      inputSummary: "dopamin.com",
      latencyMs: 10_000,
      status: "error",
      errorMessage: "AI が 10000ms 以内に応答しませんでした",
    });

    const rows = await db.select().from(schema.aiLogs);
    expect(rows[0]?.output).toBeNull();
    expect(rows[0]?.tokensIn).toBeNull();
    expect(rows[0]?.tokensOut).toBeNull();
    expect(rows[0]?.errorMessage).toBe(
      "AI が 10000ms 以内に応答しませんでした",
    );
  });

  it("users を削除すると ai_logs 行も消える（ON DELETE CASCADE）", async () => {
    const userId = await insertUser();
    await db.insert(schema.aiLogs).values({
      userId,
      feature: "subdomain_plan",
      provider: "google",
      model: "gemini-2.5-flash",
      status: "success",
    });

    await db.delete(schema.users).where(eq(schema.users.id, userId));

    expect(await db.$count(schema.aiLogs)).toBe(0);
  });

  it("user_id は NOT NULL（システム起点のログは存在しない）", async () => {
    const error = await db
      .insert(schema.aiLogs)
      .values({
        // @ts-expect-error user_id は必須。DDL 側の NOT NULL を確かめるために意図的に外す
        userId: null,
        feature: "uniqueness",
        provider: "google",
        model: "gemini-2.5-flash",
        status: "success",
      })
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect(errorText(error)).toContain("user_id");
    expect(await db.$count(schema.aiLogs)).toBe(0);
  });
});
