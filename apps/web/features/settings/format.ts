import type { PasskeySummary } from "@dopamin/shared";

/**
 * パスキー行の日時表記（Figma S-70 `85:6709`「作成 8/25 · 最終利用 3分前」）。
 *
 * 一覧はクライアントで取得してから描画するため SSR とのハイドレーション不一致は起きないが、
 * ロケール差で揺れないよう月日は自前で組み立てる。
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** これより古いものは相対表記をやめて月日で出す */
const RELATIVE_LIMIT_MS = 30 * DAY_MS;

const INVALID = "—";

/** 「8/25」 */
export function formatMonthDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return INVALID;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * 「3分前」。30 日以上前は月日に落とす。
 * 端末の時計がモックの基準時刻より前でも破綻しないよう、未来は「たった今」に丸める。
 */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return INVALID;

  const elapsed = now - date.getTime();
  if (elapsed < MINUTE_MS) return "たった今";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}分前`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}時間前`;
  if (elapsed < RELATIVE_LIMIT_MS) return `${Math.floor(elapsed / DAY_MS)}日前`;
  return formatMonthDay(iso);
}

/** 「作成 8/25 · 最終利用 3分前」（一度も使っていなければ「作成 8/25 · 未使用」） */
export function formatPasskeyMeta(
  passkey: PasskeySummary,
  now: number = Date.now(),
): string {
  const used =
    passkey.lastUsedAt === null
      ? "未使用"
      : `最終利用 ${formatRelative(passkey.lastUsedAt, now)}`;
  return `作成 ${formatMonthDay(passkey.createdAt)} · ${used}`;
}

/** 表示名が無いパスキー（レジストラ由来で name が null のことがある） */
export const UNNAMED_PASSKEY = "名前のないパスキー";

export function passkeyName(passkey: PasskeySummary): string {
  return passkey.name ?? UNNAMED_PASSKEY;
}
