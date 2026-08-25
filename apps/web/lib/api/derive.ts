/**
 * ViewModel を組み立てるときの小さな導出（mock / http の両実装で共有する）。
 * ステータス・NS・スコアの導出は `packages/shared` が SSOT。ここは API 応答にも
 * fixtures にも無い「日付の計算」だけを持つ。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 移管可能日（docs/requirements.md §9.1 `transferEligibleAt`）。
 * 直近の移管日（無ければ登録日）から 60 日後。ICANN 実運用の参考表示専用で、
 * 移管可否の判定には使わない（§11.3 の EPP ステータスだけで判定する）。
 */
export function transferEligibleAt(
  registeredAt: string,
  lastTransferAt: string | null,
): string {
  const base = new Date(lastTransferAt ?? registeredAt);
  return new Date(base.getTime() + 60 * DAY_MS).toISOString();
}
