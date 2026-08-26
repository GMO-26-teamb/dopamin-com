import { type Db, schema } from "@dopamin/db";
import type { RegistryCallRecord } from "@dopamin/registry";
import { maskSensitiveValues } from "@dopamin/shared";

/** operation_logs への INSERT 値（§9.1）。 */
export type OperationLogRow = typeof schema.operationLogs.$inferInsert;

/** ALS から取り出したリクエストコンテキスト（lib/operation-log-context.ts）。 */
export interface OperationLogContext {
  requestId: string | null;
  userId: string | null;
}

/**
 * RegistryCallRecord → operation_logs の行（§9.1）への純粋なマッピング。
 * request / response はここでマスクする（AC-15-2）。
 * request_id にはレジストリへ送った clTRID を入れる（§9.1「X-Cl-TRID に送る値と一致させる」）。
 */
export function buildOperationLogRow(
  record: RegistryCallRecord,
  context: OperationLogContext,
): OperationLogRow {
  return {
    userId: context.userId,
    requestId: record.clTrid,
    svTrid: record.svTrid,
    registry: record.registry,
    command: record.command,
    domainName: record.domainName,
    status: record.status,
    errorCode: record.errorCode,
    registryCode: record.registryCode,
    request: maskSensitiveValues(record.request),
    response: maskSensitiveValues(record.response),
    latencyMs: record.latencyMs,
  };
}

/**
 * Vercel 関数ログ向けの単一行 JSON（NFR-06）。ペイロードは載せない
 * （量と秘匿の多層防御。マスク済み request / response は DB 側にのみ残す）。
 */
export function buildOperationLogConsoleLine(
  record: RegistryCallRecord,
  context: OperationLogContext,
): Record<string, unknown> {
  return {
    level: record.status === "success" ? "info" : "warn",
    type: "operation_log",
    requestId: context.requestId,
    userId: context.userId,
    registry: record.registry,
    command: record.command,
    domainName: record.domainName,
    status: record.status,
    errorCode: record.errorCode,
    registryCode: record.registryCode,
    clTrid: record.clTrid,
    svTrid: record.svTrid,
    latencyMs: record.latencyMs,
  };
}

/** operation_logs へ 1 行 INSERT する。失敗時の扱い（握りつぶし）は呼び出し側の責務。 */
export async function recordOperationLog(
  db: Db,
  row: OperationLogRow,
): Promise<void> {
  await db.insert(schema.operationLogs).values(row);
}
