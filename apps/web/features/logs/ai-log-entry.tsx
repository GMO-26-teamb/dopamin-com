import { Badge } from "@/components/ui/badge";
import type { AiLog } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * Figma: AI Log Entry `77:121`
 * AI ログ 1 件（FR-14）。Result（Ok / Error）× Feature / Model / Input / Output / Meta。
 */

const FEATURE_LABEL: Record<AiLog["feature"], string> = {
  domain_candidates: "候補生成",
  uniqueness: "独自性スコア",
  subdomain_plan: "サブドメイン提案",
};

const MS_PER_SECOND = 1000;

/** ドロワーはクリック後にしか描画しないので、ロケール差でのハイドレーション不一致は起きない */
function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("ja-JP", { hour12: false });
}

function formatMeta(log: AiLog): string {
  const parts = [
    formatTime(log.at),
    `${(log.latencyMs / MS_PER_SECOND).toFixed(1)} s`,
  ];
  if (log.tokens !== null) {
    parts.push(`${log.tokens.toLocaleString("ja-JP")} tokens`);
  }
  return parts.join(" · ");
}

export interface AiLogEntryProps {
  log: AiLog;
  /**
   * 機能名 / モデル / 結果バッジの行を出すか。既定は true（P-01 のドロワー）。
   * S-61 の展開行では同じ値が Log Row 側に出ているので false にする。
   */
  showHeader?: boolean;
  className?: string;
}

export function AiLogEntry({
  log,
  showHeader = true,
  className,
}: AiLogEntryProps) {
  const failed = log.status === "error";

  return (
    <div
      className={cn(
        "flex w-full flex-col gap-1 border-soft border-b border-solid py-2",
        className,
      )}
    >
      {showHeader ? (
        <div className="flex w-full items-center gap-1.5">
          <span className="shrink-0 text-ink text-label-sm">
            {FEATURE_LABEL[log.feature]}
          </span>
          <span className="min-w-0 flex-1 truncate text-caption-sm text-muted">
            {log.model}
          </span>
          <Badge tone={failed ? "warn" : "ok"}>{failed ? "ERROR" : "OK"}</Badge>
        </div>
      ) : null}
      <p className="w-full text-caption text-muted">入力: {log.inputSummary}</p>
      <p
        className={cn("w-full text-body-sm", failed ? "text-warn" : "text-ink")}
      >
        出力: {log.outputSummary}
      </p>
      <p className="text-caption-sm text-muted">{formatMeta(log)}</p>
    </div>
  );
}
