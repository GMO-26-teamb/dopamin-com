"use client";

import { motion } from "motion/react";
import type { DomainSummary } from "@/lib/api/types";
import { useReducedMotion } from "@/lib/theme/use-reduced-motion";
import { cn } from "@/lib/utils";
import { DomainCard, type DomainCardProps } from "./domain-card";

/**
 * Figma: S-10 `80:5548`
 * 保有ドメインのグリッド（FR-02）。1 列（〜sm）/ 2 列 / 3 列（2xl〜）。
 * 移管済み（`transferred_out`）は出さない（AC-02-4）。
 * カードは上から順に少しずつ遅らせて現れる（動きを減らす設定では即表示）。
 */

const FADE_S = 0.25;
const STAGGER_S = 0.04;
/** これ以上のカードは遅延を伸ばさない（大量保有でも待たせない） */
const STAGGER_CAP = 12;

export interface DomainGridProps
  extends Pick<DomainCardProps, "now" | "onRenew" | "onRestore" | "onEdit"> {
  domains: readonly DomainSummary[];
  className?: string;
}

/** AC-02-4: 保有一覧に出すドメイン。 */
export function visibleDomains(
  domains: readonly DomainSummary[],
): DomainSummary[] {
  return domains.filter(
    (domain) =>
      domain.ownership === "owned" &&
      domain.displayStatus !== "transferred_out",
  );
}

export function DomainGrid({
  domains,
  now,
  onRenew,
  onRestore,
  onEdit,
  className,
}: DomainGridProps) {
  const reduced = useReducedMotion();

  return (
    <ul
      className={cn(
        "grid w-full grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 2xl:grid-cols-3",
        className,
      )}
    >
      {visibleDomains(domains).map((domain, index) => (
        <motion.li
          animate={{ opacity: 1, y: 0 }}
          className="flex"
          initial={reduced ? false : { opacity: 0, y: 8 }}
          key={domain.name}
          transition={{
            duration: FADE_S,
            delay: Math.min(index, STAGGER_CAP) * STAGGER_S,
          }}
        >
          <DomainCard
            domain={domain}
            {...(now ? { now } : {})}
            {...(onRenew ? { onRenew } : {})}
            {...(onRestore ? { onRestore } : {})}
            {...(onEdit ? { onEdit } : {})}
          />
        </motion.li>
      ))}
    </ul>
  );
}
