"use client";

import { useOperationLogs } from "@/lib/api/hooks";
import { LogList } from "./log-list";
import { OperationLogRow } from "./operation-log-row";

/** S-60 の操作ログ一覧（FR-15）。 */
export function OperationLogList() {
  const query = useOperationLogs();

  return (
    <LogList
      listLabel="操作ログ"
      query={query}
      renderRow={(log) => <OperationLogRow key={log.id} log={log} />}
    />
  );
}
