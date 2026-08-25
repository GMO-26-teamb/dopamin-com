import { createDb, type Db } from "@dopamin/db";
import { env } from "./env";

let cached: Db | undefined;

/** DB クライアント（遅延初期化のシングルトン）。接続先は Supavisor 6543（prepare: false） */
export function getDb(): Db {
  cached ??= createDb(env().DATABASE_URL);
  return cached;
}
