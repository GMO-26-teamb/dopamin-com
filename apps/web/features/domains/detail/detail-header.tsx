"use client";

import { ArrowLeftRight, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DomainDetail } from "@/lib/api/types";
import { formatRelativeTime } from "../format";
import { statusBadgeTone, statusBadgeVariant } from "../status-badge";
import { isTransferLocked, statusBadgeLabel } from "./derive";

/**
 * Figma: S-30 `83:2444` header（`83:2447`）
 * ドメイン名 + 状態バッジ + 移管ロックバッジ + 最終同期 / 再同期。
 */
export interface DetailHeaderProps {
  domain: DomainDetail;
  now: number;
  onResync: () => void;
  resyncing: boolean;
}

export function DetailHeader({
  domain,
  now,
  onResync,
  resyncing,
}: DetailHeaderProps) {
  const isTransferring =
    domain.displayStatus === "transfer_in_pending" ||
    domain.displayStatus === "transfer_out_pending";

  return (
    <div className="flex w-full items-center gap-2.5">
      <h1 className="text-domain-lg text-ink">{domain.name}</h1>
      <Badge
        icon={isTransferring ? <ArrowLeftRight /> : undefined}
        tone={statusBadgeTone(domain.displayStatus)}
        variant={statusBadgeVariant(domain.displayStatus)}
      >
        {statusBadgeLabel(domain, now)}
      </Badge>
      {isTransferLocked(domain.statuses) ? (
        <Badge tone="neutral">移管ロック中</Badge>
      ) : null}
      <div aria-hidden="true" className="min-w-0 flex-1" />
      <p className="shrink-0 text-caption text-muted">
        最終同期 {formatRelativeTime(domain.syncedAt, now)}
      </p>
      <Button
        leadingIcon={<RefreshCw />}
        loading={resyncing}
        onClick={onResync}
        size="sm"
        variant="subtle"
      >
        {resyncing ? "再同期中…" : "再同期"}
      </Button>
    </div>
  );
}
