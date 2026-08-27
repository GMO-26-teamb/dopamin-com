"use client";

import { ArrowLeftRight, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DomainDetail } from "@/lib/api/types";
import { formatRelativeTime } from "../format";
import {
  statusBadgeTone,
  statusBadgeVariant,
  statusLabel,
} from "../status-badge";

/**
 * Figma: S-30 `83:2444` header（`83:2447`）
 * ドメイン名 + 状態バッジ + 最終同期 / 再同期。
 *
 * 移管ロックはここに出さない。ロックの ON / OFF と切り替え方は操作パネルの行が持ち、
 * 根拠の EPP ステータスは基本情報カードのバッジが持つ。ヘッダーにも並べると
 * 同じ事実が 3 か所に出て、どこを見ればいいか分からなくなる。
 * 残日数も同じ理由で状態バナーに寄せてある（バッジは状態名だけ）。
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
        {statusLabel(domain.displayStatus)}
      </Badge>
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
