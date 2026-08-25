"use client";

import { useState } from "react";
import type { AiLog } from "@/lib/api/types";
import { AiLogEntry } from "./ai-log-entry";
import {
  formatJson,
  formatLatency,
  formatLogTime,
  LogDetailColumn,
  LogRow,
} from "./log-row";

/**
 * Figma: Log Row `77:85`（Kind=AI）（S-61）
 * AI ログ 1 行。展開すると出力要約 + トークン数（AI Log Entry `77:121` の再利用）と
 * 生 JSON を出す（ui-screens §2.7 S-61）。
 */

export interface AiLogRowProps {
  log: AiLog;
}

export function AiLogRow({ log }: AiLogRowProps) {
  const [expanded, setExpanded] = useState(false);
  const failed = log.status === "error";

  return (
    <LogRow
      // Figma の一覧はモデル名と並べるため機能 ID をそのまま出す（`domain-candidates`）。
      // 日本語のラベルは展開した AI Log Entry 側に出る。
      command={log.feature.replaceAll("_", "-")}
      expanded={expanded}
      latency={formatLatency(log.latencyMs)}
      onToggle={() => setExpanded((open) => !open)}
      result={{ label: failed ? "ERROR" : "OK", tone: failed ? "warn" : "ok" }}
      source={`${log.provider} / ${log.model}`}
      target={log.inputSummary}
      time={formatLogTime(log.at)}
    >
      <AiLogEntry className="border-b-0 py-0" log={log} showHeader={false} />
      <LogDetailColumn code={formatJson(log.raw)} label="raw" />
    </LogRow>
  );
}
