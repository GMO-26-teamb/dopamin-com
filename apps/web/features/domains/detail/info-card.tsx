"use client";

import { Badge } from "@/components/ui/badge";
import { Card, KeyValueRow } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Tooltip } from "@/components/ui/tooltip";
import type { DomainDetail } from "@/lib/api/types";
import {
  daysUntil,
  EXPIRY_WARN_DAYS,
  expiryPercent,
  formatDate,
  GRACE_PERIOD_LABEL,
} from "./derive";
import { eppStatusCopy } from "./epp-status";

/**
 * Figma: S-30 基本情報カード（Card `50:31` + Key Value Row `50:36` + Progress `48:19`）
 *
 * レジストリ / EPP ステータス一覧 / 登録日 / 有効期限（残日数 + 進捗）/ Grace Period /
 * 移管可能日（ツールチップで参考表示である旨）。
 */
const REGISTRY_LABEL: Record<DomainDetail["registry"], string> = {
  kitaqsign: "kitaqsign",
  kitaqnic: "kitaqnic",
  mock: "モックレジストリ",
};

export interface InfoCardProps {
  domain: DomainDetail;
  now: number;
}

export function InfoCard({ domain, now }: InfoCardProps) {
  const remainingDays = daysUntil(domain.expiresAt, now);
  const percent = expiryPercent(domain, now);
  const expiring =
    domain.expiresAt !== null && remainingDays <= EXPIRY_WARN_DAYS;
  // `pendingDelete` のように statuses と rgpStatuses の両方に来るものがあるので重複を潰す
  const eppStatuses = [...new Set([...domain.statuses, ...domain.rgpStatuses])];

  return (
    <Card kicker="基本情報">
      <KeyValueRow label="レジストリ" value={REGISTRY_LABEL[domain.registry]} />
      <KeyValueRow
        label="EPP ステータス"
        value={
          <span className="flex flex-wrap items-center justify-end gap-1">
            {eppStatuses.map((status) => (
              <EppStatusBadge key={status} status={status} />
            ))}
          </span>
        }
      />
      <KeyValueRow label="登録日" value={formatDate(domain.registeredAt)} />
      <KeyValueRow
        label="有効期限"
        value={
          domain.expiresAt === null
            ? "—"
            : `${formatDate(domain.expiresAt)}（残 ${remainingDays} 日）`
        }
      />
      <ProgressBar
        aria-label="有効期限までの残り"
        tone={expiring ? "warn" : "brand"}
        value={percent}
      />
      {domain.gracePeriods.map((gp) => (
        <KeyValueRow
          key={gp.kind}
          label={`Grace Period（${GRACE_PERIOD_LABEL[gp.kind]}）`}
          value={`${formatDate(gp.until)} まで（残 ${daysUntil(gp.until, now)} 日）`}
        />
      ))}
      <KeyValueRow
        label="移管可能日"
        value={
          <Tooltip content="ICANN 実運用の参考。可否判定には使いません">
            <button
              className="cursor-help border-muted border-b border-dotted text-ink"
              type="button"
            >
              {domain.transferableFrom === null
                ? "—"
                : `${formatDate(domain.transferableFrom)} 以降（60日ルール）`}
            </button>
          </Tooltip>
        }
      />
    </Card>
  );
}

/** 日本語ラベルのバッジ + ツールチップに英語名と説明（ui-screens §5）。 */
function EppStatusBadge({ status }: { status: string }) {
  const copy = eppStatusCopy(status);
  return (
    <Tooltip content={`${status} — ${copy.description}`}>
      <button className="inline-flex" type="button">
        <Badge tone={copy.tone}>{copy.label}</Badge>
      </button>
    </Tooltip>
  );
}
