import { rarityTier, splitDomainName, uniquenessLabel } from "@dopamin/shared";
import { TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Rarity } from "@/components/ui/rarity";
import type { Availability, UniquenessScore } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * 候補カード / 検索結果行 / 登録ダイアログで共通の表示部品（ui-screens §2.3 の Rarity 対応表）。
 * ティア・ラベルの導出は `@dopamin/shared` が SSOT で、ここでは再解釈しない。
 */

const DOMAIN_SIZE = {
  lg: "text-domain-lg",
  card: "text-domain-card",
  sm: "text-domain-sm",
} as const;

export interface DomainLabelProps {
  name: string;
  size?: keyof typeof DOMAIN_SIZE;
  /** 取得済みの候補は全体を muted にして TLD のブランド色も落とす */
  muted?: boolean;
  className?: string;
}

/** ドメイン名。SLD は ink、TLD はブランドグラデーション（Figma Candidate Card `58:249`）。 */
export function DomainLabel({
  name,
  size = "card",
  muted = false,
  className,
}: DomainLabelProps) {
  const { sld, tld } = splitDomainName(name);

  return (
    <span
      className={cn(
        DOMAIN_SIZE[size],
        muted ? "text-muted" : "text-ink",
        className,
      )}
    >
      {sld}
      <span className={cn(!muted && "brand-text")}>.{tld}</span>
    </span>
  );
}

export interface AvailabilityBadgeProps {
  availability: Availability;
  uniqueness: UniquenessScore | null;
}

/**
 * 空きバッジ（ui-screens §2.3）。
 * 空き = Neutral「空き」 / 独自性 low = Warn「紛らわしい」 /
 * 取得済み = Muted Solid「取得済み」 / check 失敗 = Warn「確認不可」。
 */
export function AvailabilityBadge({
  availability,
  uniqueness,
}: AvailabilityBadgeProps) {
  if (availability === "error") {
    return (
      <Badge icon={<TriangleAlert />} tone="warn">
        確認不可
      </Badge>
    );
  }
  if (availability === "unavailable") {
    return (
      <Badge tone="muted" variant="solid">
        取得済み
      </Badge>
    );
  }
  if (uniqueness !== null && uniqueness.label === "low") {
    return <Badge tone="warn">紛らわしい</Badge>;
  }
  return <Badge>空き</Badge>;
}

export interface RarityMarkProps {
  availability: Availability;
  uniqueness: UniquenessScore | null;
}

/** 取得済みは Rarity を出さない（ui-screens §2.3）。check 失敗はスコアだけ出す。 */
export function RarityMark({ availability, uniqueness }: RarityMarkProps) {
  if (availability === "unavailable" || uniqueness === null) {
    return (
      <span aria-hidden="true" className="text-label-xs text-muted">
        —
      </span>
    );
  }
  return <Rarity tier={rarityTier(uniqueness.score)} />;
}

const UNIQUENESS_TEXT = {
  high: "独自性高",
  medium: "独自性中",
  low: "独自性低",
} as const;

/** 独自性ラベルの日本語表記（S-25 のスコア行）。 */
export function uniquenessText(score: number): string {
  return UNIQUENESS_TEXT[uniquenessLabel(score)];
}

/** 独自性 low は Warn 色のゲージにする（ui-screens §2.3 の N）。 */
export function gaugeTone(uniqueness: UniquenessScore): "brand" | "warn" {
  return uniqueness.label === "low" ? "warn" : "brand";
}
