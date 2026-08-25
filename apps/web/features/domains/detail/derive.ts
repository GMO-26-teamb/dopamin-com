/**
 * ドメイン詳細（S-30〜S-39）の表示値の導出。
 *
 * ここは純粋関数だけを置き、`now` は必ず引数で受け取る（レンダーごとに揺れないよう
 * 画面側が 1 回だけ `Date.now()` を読む）。ステータスの解釈は `packages/shared` の
 * `deriveDisplayStatus` / `isOperationAllowed` / `isRestorable` が SSOT で、ここでは再解釈しない
 * （ui-screens §6）。
 */

import type { DisplayStatus } from "@dopamin/shared";
import { DISPLAY_STATUS_LABEL } from "@dopamin/shared";
import type { BadgeProps } from "@/components/ui/badge";
import type { DomainDetail, GracePeriod } from "@/lib/api/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** ISO 8601 → `YYYY-MM-DD`（UTC 基準。サーバー / クライアントで揺れないように）。 */
export function formatDate(iso: string | null): string {
  if (iso === null) {
    return "—";
  }
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "—" : at.toISOString().slice(0, 10);
}

/** 対象日までの残日数（切り上げ）。過去なら 0。 */
export function daysUntil(iso: string | null, now: number): number {
  if (iso === null) {
    return 0;
  }
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) {
    return 0;
  }
  return Math.max(0, Math.ceil((at - now) / DAY_MS));
}

/** 「3分前」「2時間前」「4日前」。1 分未満は「たった今」。 */
export function formatRelative(iso: string, now: number): string {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) {
    return "—";
  }
  const elapsed = Math.max(0, now - at);
  if (elapsed < MINUTE_MS) {
    return "たった今";
  }
  if (elapsed < HOUR_MS) {
    return `${Math.floor(elapsed / MINUTE_MS)}分前`;
  }
  if (elapsed < DAY_MS) {
    return `${Math.floor(elapsed / HOUR_MS)}時間前`;
  }
  return `${Math.floor(elapsed / DAY_MS)}日前`;
}

/**
 * 有効期限の残り割合（0〜100）。登録日から有効期限までを 100 とし、残っている分を返す。
 * 期限が無い（移管申請中など）ときは 0。
 */
export function expiryPercent(domain: DomainDetail, now: number): number {
  if (domain.expiresAt === null) {
    return 0;
  }
  const from = new Date(domain.registeredAt).getTime();
  const to = new Date(domain.expiresAt).getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) {
    return 0;
  }
  const remaining = to - now;
  return Math.min(100, Math.max(0, (remaining / (to - from)) * 100));
}

/** 残り 30 日以内は警告色にする（Domain Card と同じ閾値）。 */
export const EXPIRY_WARN_DAYS = 30;

/** 画面バッジの tone（Figma の Badge Tone に 1:1）。 */
const BADGE_TONE: Record<DisplayStatus, NonNullable<BadgeProps["tone"]>> = {
  active: "ok",
  rgp: "warn",
  pending_delete: "warn",
  transfer_in_pending: "brand",
  transfer_out_pending: "brand",
  transferred_out: "muted",
  hold: "warn",
  inactive: "neutral",
  locked: "neutral",
};

export function statusBadgeTone(
  status: DisplayStatus,
): NonNullable<BadgeProps["tone"]> {
  return BADGE_TONE[status];
}

/** 状態バッジの文言。RGP / 削除待ちは残日数を添える（S-33 / S-36）。 */
export function statusBadgeLabel(domain: DomainDetail, now: number): string {
  const base = DISPLAY_STATUS_LABEL[domain.displayStatus];
  if (domain.displayStatus === "rgp") {
    return `${base} 残 ${daysUntil(domain.rgpUntil, now)} 日`;
  }
  if (domain.displayStatus === "pending_delete") {
    const until = gracePeriodOf(domain, "pendingDelete");
    return until === null
      ? base
      : `${base} 残 ${daysUntil(until.until, now)} 日`;
  }
  return base;
}

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

/** 延長後の有効期限（`YYYY-MM-DD`）。 */
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
  at.setUTCFullYear(at.getUTCFullYear() + period);
  return at.toISOString().slice(0, 10);
}
