import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * 実行時の DB クライアント。
 * Supavisor のトランザクションモード（6543）は prepared statement 非対応のため prepare: false。
 */
export function createDb(url: string) {
  const client = postgres(url, { prepare: false });
  return drizzle({ client, schema });
}

export type Db = ReturnType<typeof createDb>;
