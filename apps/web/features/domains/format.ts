/**
 * ダッシュボード（S-10〜S-13）の日付・相対時刻・進捗の表示計算。
 *
 * 表示は閲覧環境のローカル時刻で行う。データは `useDomains()` 取得後にしか描画しないため
 * SSR とのズレ（ハイドレーション不一致）は起きない。
 * 基準時刻 `now` は必ず引数で受け取り、テストで固定できるようにする。
 */

import { clampPercent } from "@/components/ui/progress-bar";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** 値が無い / 壊れているときの表示。 */
const PLACEHOLDER = "—";

function toDate(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** ローカル時刻での「その日の 0 時」。日付差を時刻に依存させないために使う。 */
function startOfDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

/** `2027-08-25` 形式（ローカル日付）。 */
export function formatDate(iso: string): string {
  const date = toDate(iso);
  if (date === null) {
    return PLACEHOLDER;
  }
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 残日数（日単位・ui-screens §6）。時刻ではなく暦日で数えるので、
 * 同じ fixture がいつ実行されても「残 23 日」のまま表示できる。
 * 過去日付は負の数を返す。
 */
export function daysUntil(iso: string, now: Date): number | null {
  const date = toDate(iso);
  if (date === null) {
    return null;
  }
  // 夏時間のある地域で 1 日が 23/25 時間になっても丸めで吸収する
  return Math.round((startOfDay(date) - startOfDay(now)) / MS_PER_DAY);
}

/** 「たった今」「3分前」「2時間前」「5日前」。未来はすべて「たった今」。 */
export function formatRelativeTime(iso: string, now: Date): string {
  const date = toDate(iso);
  if (date === null) {
    return PLACEHOLDER;
  }
  const elapsed = now.getTime() - date.getTime();
  if (elapsed < MS_PER_MINUTE) {
    return "たった今";
  }
  if (elapsed < MS_PER_HOUR) {
    return `${Math.floor(elapsed / MS_PER_MINUTE)}分前`;
  }
  if (elapsed < MS_PER_DAY) {
    return `${Math.floor(elapsed / MS_PER_HOUR)}時間前`;
  }
  return `${Math.floor(elapsed / MS_PER_DAY)}日前`;
}

/**
 * 有効期限プログレスの値（0〜100）。Figma の Domain Card は「残っている割合」を
 * 塗るので（Active ≒ 96%、Expiring ≒ 6%）、登録日〜有効期限のうち残りの比率を返す。
 */
export function remainingPercent(
  registeredAt: string,
  expiresAt: string | null,
  now: Date,
): number {
  const start = toDate(registeredAt);
  const end = expiresAt === null ? null : toDate(expiresAt);
  if (start === null || end === null || end.getTime() <= start.getTime()) {
    return 0;
  }
  const total = end.getTime() - start.getTime();
  return clampPercent(((end.getTime() - now.getTime()) / total) * 100);
}
