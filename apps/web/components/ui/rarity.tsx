import { cn } from "@/lib/utils";

/**
 * Figma: Rarity `44:62`
 * 独自性スコアのレア度。SSR = ブランドグラデーション文字（80+）、R = link 色（70–79）、
 * N = muted（70 未満・紛らわしい）。ティアの導出は `@dopamin/shared` の `rarityTier`。
 */
const TIER_CLASS = {
  SSR: "bg-[image:var(--gradient-brand)] bg-clip-text text-transparent",
  R: "text-link",
  N: "text-muted",
} as const;

export interface RarityProps {
  tier: "SSR" | "R" | "N";
  className?: string;
}

export function Rarity({ tier, className }: RarityProps) {
  return (
    <span className={cn("text-label-xs", TIER_CLASS[tier], className)}>
      {tier}
    </span>
  );
}
