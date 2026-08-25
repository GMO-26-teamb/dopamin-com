"use client";

import type { DomainSummary } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { DomainCard, type DomainCardProps } from "./domain-card";

/**
 * Figma: S-10 `80:5548`
 * 保有ドメインの 2 列グリッド（FR-02）。移管済み（`transferred_out`）は出さない（AC-02-4）。
 */

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
  return (
    <ul className={cn("grid w-full grid-cols-2 gap-x-4 gap-y-3", className)}>
      {visibleDomains(domains).map((domain) => (
        <li className="flex" key={domain.name}>
          <DomainCard
            domain={domain}
            {...(now ? { now } : {})}
            {...(onRenew ? { onRenew } : {})}
            {...(onRestore ? { onRestore } : {})}
            {...(onEdit ? { onEdit } : {})}
          />
        </li>
      ))}
    </ul>
  );
}
