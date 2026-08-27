import { type Db, schema } from "@dopamin/db";
import type { RegistryCallRecord } from "@dopamin/registry";
import type {
  OperationCommand,
  OperationLogStatus,
  RegistryId,
} from "@dopamin/shared";
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
 * レジストリ通信を伴わないアプリ内操作 1 回（`APP_OPERATION_COMMANDS`）。
 * FR-13 の「DNS に反映」がこれにあたる。`clTRID` / `svTRID` / `registryCode` は持たない。
 */
export interface AppOperationRecord {
  userId: string;
  requestId: string | null;
  /** 操作の対象ドメインが属するレジストリ（列が NOT NULL のため必ず入れる）。 */
  registry: RegistryId;
  command: OperationCommand;
  domainName: string;
  status: OperationLogStatus;
  errorCode: string | null;
  /** 操作の入力・結果（機密値は無いが、経路を揃えるためマスクは通す）。 */
  request: unknown;
  response: unknown;
  latencyMs: number;
}

/** アプリ内操作 → operation_logs の行（§9.1）。 */
export function buildAppOperationLogRow(
  record: AppOperationRecord,
): OperationLogRow {
  return {
    userId: record.userId,
    // レジストリに送った clTRID は無いので、API リクエストの x-request-id をそのまま入れる
    requestId: record.requestId,
    svTrid: null,
    registry: record.registry,
    command: record.command,
    domainName: record.domainName,
    status: record.status,
    errorCode: record.errorCode,
    registryCode: null,
    request: maskSensitiveValues(record.request),
    response: maskSensitiveValues(record.response),
    latencyMs: record.latencyMs,
  };
}

/**
 * アプリ内操作を記録する（console → INSERT の順は `handleRegistryCall` と同じ）。
 * 記録の失敗は操作の成否に影響させない（既に成立した反映を巻き戻さない）。
 */
export async function recordAppOperation(
  db: Db,
  record: AppOperationRecord,
): Promise<void> {
  console.log(
    JSON.stringify({
      level: record.status === "success" ? "info" : "warn",
      type: "operation_log",
      requestId: record.requestId,
      userId: record.userId,
      registry: record.registry,
      command: record.command,
      domainName: record.domainName,
      status: record.status,
      errorCode: record.errorCode,
      latencyMs: record.latencyMs,
    }),
  );
  try {
    await recordOperationLog(db, buildAppOperationLogRow(record));
  } catch (cause) {
    const root =
      cause instanceof Error && cause.cause instanceof Error
        ? cause.cause
        : cause;
    console.error(
      JSON.stringify({
        level: "error",
        type: "operation_log_write_failed",
        requestId: record.requestId,
        registry: record.registry,
        command: record.command,
        reason:
          root instanceof OperationLogWriteTimeoutError ? "timeout" : "error",
        errorName: root instanceof Error ? root.name : null,
        message: (root instanceof Error ? root.message : String(root)).slice(
          0,
          300,
        ),
      }),
    );
  }
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
