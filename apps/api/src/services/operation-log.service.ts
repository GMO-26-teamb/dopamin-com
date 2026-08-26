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

/**
 * INSERT を待つ上限。DB に到達できない（SYN drop・Supavisor 飽和）場合に postgres-js の
 * 接続タイムアウト（既定 30s）までレジストリ操作の応答が遅れないようにする。
 * create のように 1 リクエストで複数回呼ばれる経路では累積するため短めに取る。
 */
export const OPERATION_LOG_WRITE_TIMEOUT_MS = 3_000;

/** INSERT が上限時間内に終わらなかったことを表す（呼び出し側が reason: "timeout" として出力する）。 */
export class OperationLogWriteTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `operation_logs への INSERT が ${timeoutMs}ms 以内に完了しませんでした`,
    );
    this.name = "OperationLogWriteTimeoutError";
  }
}

/**
 * operation_logs へ 1 行 INSERT する。失敗時の扱い（握りつぶし）は呼び出し側の責務。
 * `timeoutMs` を超えると OperationLogWriteTimeoutError で reject する
 * （INSERT 自体は打ち切らず裏で続行するため、遅れて成功することはある）。
 */
export async function recordOperationLog(
  db: Db,
  row: OperationLogRow,
  timeoutMs: number = OPERATION_LOG_WRITE_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new OperationLogWriteTimeoutError(timeoutMs)),
      timeoutMs,
    );
  });
  try {
    await Promise.race([db.insert(schema.operationLogs).values(row), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
