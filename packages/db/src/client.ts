import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * DB クライアントの型。ドライバに依存しない pg-core の `PgDatabase` で表す。
 * 本番は postgres-js（Supavisor）、テストは pglite（apps/api/test/helpers/db.ts）の drizzle
 * インスタンスを同じ型で `setDbForTesting` に注入できるようにするため、
 * `PostgresJsDatabase` ではなく共通型にしている（クエリビルダは構造的に同じ）。
 * ドライバ固有の `$client` は公開しない。
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * 実行時の DB クライアント。
 * Supavisor のトランザクションモード（6543）は prepared statement 非対応のため prepare: false。
 */
export function createDb(url: string): Db {
  const client = postgres(url, { prepare: false });
  return drizzle({ client, schema });
}
