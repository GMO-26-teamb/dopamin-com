import type { DomainSummary } from "@/lib/api/types";

/**
 * ダッシュボードの背後同期（S-10 / FR-02）の判定。
 *
 * Next.js の Page モジュールは `default` と決められたメタデータ以外を export できないため
 * （`next build --webpack` の型チェックが落ちる）、純粋関数はここに置いてテストもここから読む。
 */

/** 自動同期をスキップする鮮度のしきい値（ms）。「最新化」ボタンの手動実行はこのガードの対象外。 */
export const AUTO_SYNC_FRESHNESS_MS = 60_000;

/** 一覧の中でもっとも新しい `syncedAt`。1 件もなければ null。 */
export function latestSyncedAt(
  domains: readonly DomainSummary[],
): string | null {
  return domains.reduce<string | null>(
    (latest, domain) =>
      latest === null || domain.syncedAt > latest ? domain.syncedAt : latest,
    null,
  );
}

/**
 * 背後の自動同期（マウント / シナリオ変更のたびに 1 回走る `useSyncDomains`）を実行してよいか。
 * 一覧の中でもっとも新しい `syncedAt` が 60 秒未満なら、まだ十分新しいのでスキップする。
 */
export function shouldAutoSync(
  domains: readonly DomainSummary[],
  now: Date,
): boolean {
  const syncedAt = latestSyncedAt(domains);
  if (syncedAt === null) {
    return true;
  }
  const elapsed = now.getTime() - new Date(syncedAt).getTime();
  return elapsed >= AUTO_SYNC_FRESHNESS_MS;
}
