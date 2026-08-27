import { type Db, schema } from "@dopamin/db";
import type { MockStateSnapshot, MockStateStore } from "@dopamin/registry";
import type { RegistryId } from "@dopamin/shared";
import { eq } from "drizzle-orm";
import { getDb } from "../lib/db";

/**
 * mock レジストリの状態を DB に逃がすストア（docs/requirements.md §11.1 / §16.1。#46）。
 *
 * `REGISTRY_MODE=mock` のときだけ配線する。Vercel Functions では
 * `MockRegistryAdapter` のプロセス内 Map がインスタンス跨ぎ・コールドスタートで消え、
 * create したドメインが次のリクエストの `info` で 2303 になる。
 *
 * **DB が使えないときは黙って諦める**（プロセス内 Map で動き続ける）。
 * これはデモ用の再現であって、レジストリ状態の保存に失敗したからといって
 * API を落とす価値は無い。失敗は構造化ログに残す（NFR-06）。
 */

/**
 * 読み出した JSON が `MockStateSnapshot` の形をしているか。
 *
 * 中身の詳細（1 ドメインの各フィールド）までは検証しない: 型は
 * `packages/registry` の内部表現で、ここで二重定義すると必ずずれる。
 * 壊れていた場合の被害はデモ状態が空に戻ることだけなので、
 * トップレベルの形だけ見て、合わなければ「未保存」として扱う（NFR-05）。
 */
function isSnapshot(value: unknown): value is MockStateSnapshot {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<MockStateSnapshot>;
  return (
    Array.isArray(candidate.domains) &&
    typeof candidate.queues === "object" &&
    candidate.queues !== null &&
    typeof candidate.contacts === "object" &&
    candidate.contacts !== null &&
    typeof candidate.nextMessageId === "number"
  );
}

function warn(action: string, registry: RegistryId, err: unknown): void {
  console.warn(
    JSON.stringify({
      level: "warn",
      type: "mock_state_store_failed",
      action,
      registry,
      message: err instanceof Error ? err.message : String(err),
    }),
  );
}

/** `mock_registry_state` を使う `MockStateStore`（レジストリ 1 つにつき 1 行）。 */
export function createDbMockStateStore(
  registry: RegistryId,
  db: () => Db = getDb,
): MockStateStore {
  return {
    async load() {
      try {
        const rows = await db()
          .select()
          .from(schema.mockRegistryState)
          .where(eq(schema.mockRegistryState.registry, registry))
          .limit(1);
        const snapshot = rows[0]?.snapshot;
        return isSnapshot(snapshot) ? snapshot : null;
      } catch (err) {
        warn("load", registry, err);
        return null;
      }
    },

    async save(snapshot) {
      try {
        await db()
          .insert(schema.mockRegistryState)
          .values({ registry, snapshot, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: schema.mockRegistryState.registry,
            set: { snapshot, updatedAt: new Date() },
          });
      } catch (err) {
        warn("save", registry, err);
      }
    },
  };
}
