/**
 * `DisplayStatus` → 状態バッジの Tone / Variant / ラベル（ui-screens §2.2 の Status 表）。
 *
 * ダッシュボードの Domain Card（S-10〜S-13）とドメイン詳細のヘッダー（S-30〜S-39）で
 * 同じ表を使う。ステータスの導出そのものは `packages/shared` の `deriveDisplayStatus`
 * が SSOT で、ここでは見た目への写像だけを持つ。
 */

import type { DisplayStatus } from "@dopamin/shared";
import { DISPLAY_STATUS_LABEL } from "@dopamin/shared";
import type { BadgeProps } from "@/components/ui/badge";

type BadgeTone = NonNullable<BadgeProps["tone"]>;
type BadgeVariant = NonNullable<BadgeProps["variant"]>;

interface StatusBadgeStyle {
  tone: BadgeTone;
  variant: BadgeVariant;
}

/**
 * ui-screens §2.2 の「バッジ（Tone）」列に 1:1。
 * 移管中と削除待ちは進行中でローカルからは触れない状態なので Muted
 * （削除待ちだけ Solid で塗り、他は Outline）。
 */
const STATUS_BADGE: Record<DisplayStatus, StatusBadgeStyle> = {
  active: { tone: "ok", variant: "outline" },
  rgp: { tone: "warn", variant: "outline" },
  pending_delete: { tone: "muted", variant: "solid" },
  transfer_in_pending: { tone: "muted", variant: "outline" },
  transfer_out_pending: { tone: "muted", variant: "outline" },
  transferred_out: { tone: "muted", variant: "outline" },
  hold: { tone: "warn", variant: "outline" },
  inactive: { tone: "neutral", variant: "outline" },
  locked: { tone: "neutral", variant: "outline" },
};

export function statusBadgeTone(status: DisplayStatus): BadgeTone {
  return STATUS_BADGE[status].tone;
}

export function statusBadgeVariant(status: DisplayStatus): BadgeVariant {
  return STATUS_BADGE[status].variant;
}

/** 状態バッジの基本ラベル（残日数などの付加は呼び出し側で足す）。 */
export function statusLabel(status: DisplayStatus): string {
  return DISPLAY_STATUS_LABEL[status];
}
