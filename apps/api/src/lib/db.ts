import { createDb, type Db } from "@dopamin/db";
import { env } from "./env";

let cached: Db | null = null;

/** DB クライアント（遅延初期化のシングルトン）。接続先は Supavisor 6543（prepare: false） */
export function getDb(): Db {
  if (cached === null) {
    cached = createDb(env().DATABASE_URL);
  }
  return cached;
}

/**
 * テスト専用: DB クライアントを差し替える（pglite のテスト DB を注入する。
 * apps/api/test/helpers/db.ts の createTestDb と組で使う）。
 * null でキャッシュを破棄し、次回アクセス時に環境変数から再構築させる。
 * 本番コードからは呼ばない。setRegistrySetForTesting と同じ流儀。
 */
export function setDbForTesting(db: Db | null): void {
  cached = db;
}
