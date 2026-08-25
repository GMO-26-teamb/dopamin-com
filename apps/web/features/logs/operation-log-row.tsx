"use client";

import { useState } from "react";
import type { OperationLog } from "@/lib/api/types";
import {
  formatJson,
  formatLatency,
  formatLogTime,
  LogDetailColumn,
  LogRow,
} from "./log-row";

/**
 * Figma: Log Row `77:85`（Kind=Operation）+ Log Detail `77:90`
 * 操作ログ 1 行（S-60 / S-61）。展開すると request / response を並べる。
 */

const STATUS_LABEL: Record<OperationLog["status"], string> = {
  success: "OK",
  error: "ERROR",
  timeout: "TIMEOUT",
  spec_mismatch: "SPEC MISMATCH",
};

/**
 * 結果列のラベル。レジストリが返したコードがあれば前に付ける（`2202 ERROR`）。
 * 成功でコードが無いときは `OK` だけ（EPP の 1000 を UI で作らない）。
 */
export function operationResultLabel(log: OperationLog): string {
  const status = STATUS_LABEL[log.status];
  return log.registryCode === null ? status : `${log.registryCode} ${status}`;
}

export interface OperationLogRowProps {
  log: OperationLog;
}

export function OperationLogRow({ log }: OperationLogRowProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <LogRow
      command={log.command}
      expanded={expanded}
      latency={formatLatency(log.latencyMs)}
      onToggle={() => setExpanded((open) => !open)}
      result={{
        label: operationResultLabel(log),
        tone: log.status === "success" ? "ok" : "warn",
      }}
      source={log.registry}
      target={log.domainName ?? "—"}
      targetClassName="text-domain-sm"
      time={formatLogTime(log.at)}
    >
      {log.errorCode === null ? null : (
        <p className="w-full text-caption text-warn">
          エラーコード: {log.errorCode}
        </p>
      )}
      <div className="flex w-full flex-col items-start gap-3 md:flex-row">
        <LogDetailColumn code={formatJson(log.request)} label="request" />
        <LogDetailColumn code={formatJson(log.response)} label="response" />
      </div>
    </LogRow>
  );
}
