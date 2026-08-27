import { readFile } from "node:fs/promises";
import { type Db, schema } from "@dopamin/db";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { z } from "zod";

/**
 * packages/db/drizzle（drizzle-kit の出力先）。apps/api/test/helpers から見た相対位置。
 * 末尾の "/" は new URL(相対パス, base) で子パスを解決するために必要。
 */
const MIGRATIONS_DIR = new URL(
  "../../../../packages/db/drizzle/",
  import.meta.url,
);

/** drizzle-kit が書く meta/_journal.json のうち、適用順の決定に必要な部分だけを検証する */
const journalSchema = z.object({
  entries: z.array(
    z.object({
      idx: z.number().int().nonnegative(),
      tag: z.string().min(1),
    }),
  ),
});

/** drizzle-kit が SQL 文の区切りに書くマーカー（`breakpoints: true`） */
const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

/** _journal.json の順に <tag>.sql を読み、statement-breakpoint で分割した SQL 文の配列を返す */
async function loadMigrationStatements(): Promise<string[]> {
  const journalText = await readFile(
    new URL("meta/_journal.json", MIGRATIONS_DIR),
    "utf8",
  );
  const journal = journalSchema.parse(JSON.parse(journalText));
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);
  const statements: string[] = [];
  for (const entry of entries) {
    const sqlText = await readFile(
      new URL(`${entry.tag}.sql`, MIGRATIONS_DIR),
      "utf8",
    );
    for (const statement of sqlText.split(STATEMENT_BREAKPOINT)) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
    }
  }
  return statements;
}

/**
 * pglite（インメモリ Postgres 17）に packages/db/drizzle のマイグレーションを全適用した
 * テスト用 Db を返す（FR-01 spec §9）。`setDbForTesting(db)` で apps/api に注入する。
 * 1 テストファイルにつき 1 回 `beforeAll` で作り、`afterAll` で `close()` する（起動に 1〜2 秒）。
 */
export async function createTestDb(): Promise<{
  db: Db;
  close: () => Promise<void>;
}> {
  const client = await PGlite.create();
  for (const statement of await loadMigrationStatements()) {
    await client.exec(statement);
  }
  const db: Db = drizzle({ client, schema });
  return { db, close: () => client.close() };
}

/**
 * 全テーブルを空にする（テスト間の独立性用）。
 * users を TRUNCATE すると、users を参照する FK を持つ sessions / passkey_credentials /
 * domains / contacts / transfers / operation_logs / ai_logs も TRUNCATE ... CASCADE の
 * 対象になる（operation_logs の FK は ON DELETE SET NULL だが、TRUNCATE CASCADE は
 * delete rule に関係なく参照テーブルを空にする）。
 * webauthn_challenges は FK を持たないので明示する。
 */
export async function resetTestDb(db: Db): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE "users", "webauthn_challenges" CASCADE`);
}
