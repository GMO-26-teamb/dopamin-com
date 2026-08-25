/**
 * 日付導出ロジック（docs/requirements.md §9.2）。
 *
 * 現在時刻は必ず `now` 引数で受け取る。テストで固定できるよう、
 * 既定値としてのみ `new Date()` を使う（関数内部で暗黙に `Date.now()` を呼ばない）。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 移管申請から自動承認までの既定時間（20 分）。
 * レジストリ（kitaqsign）が `acDate` を返さない場合のフォールバックとして必須
 * （docs/requirements.md §9.1 / §11.3、issue SHARED-03）。
 */
export const TRANSFER_AUTO_APPROVE_MS = 20 * 60 * 1000;

/**
 * 移管可能日（参考表示）の経過日数。ICANN の 60 日ルール。
 * レジストリは強制せず、アプリも移管可否の判定には使わない（FR-12、§11.3）。
 */
export const TRANSFER_ELIGIBLE_DAYS = 60;

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** ローカル日付での「その日の 0 時」。日付差を時刻に依存させないために使う。 */
function startOfDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

/**
 * `expiresAt` までの残り日数（暦日・整数）。有効期限の 30 日警告に使う
 * （docs/requirements.md AC-02-2）。
 *
 * 時刻ではなく暦日（ローカル日付の 0 時基準）で数える。同じ日なら 0、
 * 翌日なら 1、前日なら -1 を返す。夏時間で 1 日が 23/25 時間になる地域でも
 * 丸めで吸収するため結果はずれない。
 */
export function daysUntil(
  expiresAt: string | Date,
  now: Date = new Date(),
): number {
  const target = toDate(expiresAt);
  return Math.round((startOfDay(target) - startOfDay(now)) / DAY_MS);
}

/**
 * 移管申請の自動承認期限（docs/requirements.md §9.2 `transferAutoApproveAt`）。
 *
 * レジストリが自動承認期限（`actByAt`。kitaqsign の `acDate` 等）を返せば
 * それを優先する。返さない場合（kitaqsign は返さないため必須の分岐）は
 * `requestedAt` + {@link TRANSFER_AUTO_APPROVE_MS}（20 分後）を使う。
 * losing 側が放置した場合にサーバが自動承認するタイミングの表示に使う
 * （AC-07-3、§11.3）。
 */
export function transferAutoApproveAt(
  requestedAt: string | Date,
  actByAt?: string | Date | null,
): Date {
  if (actByAt != null) {
    return toDate(actByAt);
  }
  return new Date(toDate(requestedAt).getTime() + TRANSFER_AUTO_APPROVE_MS);
}

/**
 * 移管可能日（docs/requirements.md §9.2 `transferEligibleAt`）。
 *
 * **参考表示専用。移管可否の判定には使わない。** レジストリは ICANN の
 * 60 日ルールを強制せず、アプリもこの値で移管操作をブロックしない
 * （FR-12。可否は §11.3 の EPP ステータスのみで判定する）。
 *
 * 登録日と直近の移管日のうち遅い方から {@link TRANSFER_ELIGIBLE_DAYS}
 * （60 日）後を返す。`lastTransferAt` が無ければ登録日を基準にする。
 */
export function transferEligibleAt(
  registeredAt: string | Date,
  lastTransferAt: string | Date | null,
): Date {
  const registered = toDate(registeredAt);
  const base = lastTransferAt == null ? registered : toDate(lastTransferAt);
  const latest = base.getTime() > registered.getTime() ? base : registered;
  return new Date(latest.getTime() + TRANSFER_ELIGIBLE_DAYS * DAY_MS);
}
