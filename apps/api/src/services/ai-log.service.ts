import { type Db, schema } from "@dopamin/db";
import {
  type AiFeature,
  type AiLogStatus,
  type AiProvider,
  summarizeForAiLog,
} from "@dopamin/shared";

/** ai_logs への INSERT 値（§9.1）。 */
export type AiLogRow = typeof schema.aiLogs.$inferInsert;

/**
 * AI 呼び出し 1 回の結果（成功・失敗とも）。lib/ai-provider.ts が組み立てて渡す。
 * `input` は要約前の値で、DB に載る前に必ず `summarizeForAiLog` を通る（AC-14-2）。
 */
export interface AiCallRecord {
  /** ai_logs.user_id は NOT NULL。システム起点の AI 呼び出しは存在しない */
  userId: string;
  feature: AiFeature;
  /** 実際に応答した（＝最後に試した）プロバイダ。フォールバックした場合は切替後の値 */
  provider: AiProvider;
  model: string;
  /** 呼び出しの意味的な入力（プロンプト全文ではない）。要約して input_summary に入れる */
  input: unknown;
  /** zod で再検証済みの構造化出力。失敗時は undefined */
  output?: unknown;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number;
  status: AiLogStatus;
  /** 失敗時のメッセージ（プロバイダの生文言。クライアントには返さない） */
  errorMessage?: string;
}

/**
 * `error_message` の保存上限。プロバイダのエラーは応答ボディ丸ごとを含むことがあり、
 * そのまま入れると DB が肥大する（AC-14-2 と同じ理由）。
 */
export const AI_ERROR_MESSAGE_MAX_LENGTH = 300;

/**
 * AiCallRecord → ai_logs の行（§9.1）への純粋なマッピング。
 * プロンプト全文は入らない。入力は `summarizeForAiLog` で 200 字以内に畳む（AC-14-2）。
 */
export function buildAiLogRow(record: AiCallRecord): AiLogRow {
  return {
    userId: record.userId,
    feature: record.feature,
    provider: record.provider,
    model: record.model,
    inputSummary: summarizeForAiLog(record.input),
    output: record.output ?? null,
    tokensIn: record.tokensIn,
    tokensOut: record.tokensOut,
    latencyMs: record.latencyMs,
    status: record.status,
    errorMessage:
      record.errorMessage === undefined
        ? null
        : summarizeForAiLog(record.errorMessage, AI_ERROR_MESSAGE_MAX_LENGTH),
  };
}

/**
 * Vercel 関数ログ向けの単一行 JSON（NFR-06）。
 * 入出力は載せない（量と秘匿の多層防御。要約と構造化出力は DB 側にのみ残す）。
 */
export function buildAiLogConsoleLine(
  record: AiCallRecord,
  context: { requestId: string | null },
): Record<string, unknown> {
  return {
    level: record.status === "success" ? "info" : "warn",
    type: "ai_log",
    requestId: context.requestId,
    userId: record.userId,
    feature: record.feature,
    provider: record.provider,
    model: record.model,
    status: record.status,
    tokensIn: record.tokensIn,
    tokensOut: record.tokensOut,
    latencyMs: record.latencyMs,
    errorMessage:
      record.errorMessage === undefined
        ? null
        : summarizeForAiLog(record.errorMessage, AI_ERROR_MESSAGE_MAX_LENGTH),
  };
}

/**
 * INSERT を待つ上限。DB に到達できない場合に postgres-js の接続タイムアウト
 * （既定 30s）まで AI 応答の返却が遅れないようにする
 * （operation_logs と同じ理由・同じ値。services/operation-log.service.ts）。
 */
export const AI_LOG_WRITE_TIMEOUT_MS = 3_000;

/** INSERT が上限時間内に終わらなかったことを表す（呼び出し側が reason: "timeout" として出力する）。 */
export class AiLogWriteTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`ai_logs への INSERT が ${timeoutMs}ms 以内に完了しませんでした`);
    this.name = "AiLogWriteTimeoutError";
  }
}

/**
 * ai_logs へ 1 行 INSERT する。失敗時の扱い（握りつぶし）は呼び出し側の責務。
 * `timeoutMs` を超えると AiLogWriteTimeoutError で reject する
 * （INSERT 自体は打ち切らず裏で続行するため、遅れて成功することはある）。
 */
export async function recordAiLog(
  db: Db,
  row: AiLogRow,
  timeoutMs: number = AI_LOG_WRITE_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new AiLogWriteTimeoutError(timeoutMs)),
      timeoutMs,
    );
  });
  try {
    await Promise.race([db.insert(schema.aiLogs).values(row), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
