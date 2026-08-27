/**
 * ドメイン詳細（S-30〜S-39）の表示値の導出。
 *
 * ここは純粋関数だけを置き、`now` は必ず引数で受け取る（レンダーごとに揺れないよう
 * 画面側が 1 回だけ `Date.now()` を読む）。ステータスの解釈は `packages/shared` の
 * `deriveDisplayStatus` / `isOperationAllowed` / `isRestorable` が SSOT で、ここでは再解釈しない
 * （ui-screens §6）。
 *
 * 日付・相対時刻・残日数は `../format`（ダッシュボードと共通・ローカル暦日基準）、
 * 状態バッジの Tone は `../status-badge` に統合済み。ここでは再実装しない。
 */

import type { DomainDetail, GracePeriod } from "@/lib/api/types";
import { formatDate } from "../format";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 残り 30 日以内は警告色にする（Domain Card と同じ閾値）。 */
export const EXPIRY_WARN_DAYS = 30;

/**
 * 状態バッジは状態名だけを出す（`statusLabel`）。残日数は Banner に 1 本化した:
 * ヘッダー・Banner・基本情報カードの 3 か所に同じ日数が並んでいたうえ、
 * 猶予期限が分からないとき（`rgpUntil === null`）に「残 0 日」と読めてしまった（#211）。
 */

/** 指定種別の Grace Period を返す。 */
export function gracePeriodOf(
  domain: DomainDetail,
  kind: GracePeriod["kind"],
): GracePeriod | null {
  return domain.gracePeriods.find((gp) => gp.kind === kind) ?? null;
}

/** Add Grace Period（登録後 5 日）内か。D-03 の文言を切り替える（FR-10 / §11.4）。 */
export const ADD_GRACE_PERIOD_DAYS = 5;

export function isWithinAddGracePeriod(
  domain: DomainDetail,
  now: number,
): boolean {
  const add = gracePeriodOf(domain, "add");
  if (add !== null) {
    return new Date(add.until).getTime() > now;
  }
  const registeredAt = new Date(domain.registeredAt).getTime();
  if (Number.isNaN(registeredAt)) {
    return false;
  }
  return now - registeredAt < ADD_GRACE_PERIOD_DAYS * DAY_MS;
}

/** Grace Period の日本語ラベル（§11.4）。 */
export const GRACE_PERIOD_LABEL: Record<GracePeriod["kind"], string> = {
  add: "Add GP（無課金取消）",
  renew: "Renew GP",
  transfer: "Transfer GP",
  autoRenew: "Auto-Renew GP",
  redemption: "Redemption GP（復旧猶予）",
  pendingDelete: "Pending Delete",
};

/** 移管ロック（`client/serverTransferProhibited`）が付いているか。 */
export function isTransferLocked(statuses: readonly string[]): boolean {
  return statuses.some(
    (s) => s === "clientTransferProhibited" || s === "serverTransferProhibited",
  );
}

/** 有効期限が 10 年上限に収まる最大の延長年数（AC-08-2）。0 なら延長できない。 */
export const MAX_REGISTRATION_YEARS = 10;

export function maxRenewPeriod(expiresAt: string | null, now: number): number {
  if (expiresAt === null) {
    return 0;
  }
  const to = new Date(expiresAt).getTime();
  if (Number.isNaN(to)) {
    return 0;
  }
  // 残存期間（年、切り上げ）。合計が 10 年を超えない範囲だけを選ばせる
  const remainingYears = Math.max(0, Math.ceil((to - now) / (365 * DAY_MS)));
  return Math.min(
    MAX_REGISTRATION_YEARS,
    Math.max(0, MAX_REGISTRATION_YEARS - remainingYears),
  );
}

/** 延長後の有効期限（`YYYY-MM-DD`・ローカル日付）。 */
export function renewedExpiry(
  expiresAt: string | null,
  period: number,
): string {
  if (expiresAt === null) {
    return "—";
  }
  const at = new Date(expiresAt);
  if (Number.isNaN(at.getTime())) {
    return "—";
  }
  at.setFullYear(at.getFullYear() + period);
  return formatDate(at.toISOString());
}
