"use client";

import { useAiLogs } from "@/lib/api/hooks";
import { AiLogRow } from "./ai-log-row";
import { LogList } from "./log-list";

/** S-61 の AI ログ一覧（FR-14）。 */
export function AiLogList() {
  const query = useAiLogs();

  return (
    <LogList
      listLabel="AI ログ"
      query={query}
      renderRow={(log) => <AiLogRow key={log.id} log={log} />}
    />
  );
}
