/**
 * ログ API の契約（docs/requirements.md §10.1 `GET /logs/operations`・`GET /logs/ai` / FR-14・FR-15）。
 *
 * 一覧はどちらもユーザー自身のログのみを新しい順で返し、カーソルページングで辿る。
 * 行の形は §9.1 の `operation_logs` / `ai_logs` から、画面が使わない列
 * （`user_id` など）を落として ISO 文字列に直したもの。
 */

import { z } from "zod";
import { aiFeatureSchema, aiLogStatusSchema, aiProviderSchema } from "./ai";
import { apiErrorCodeSchema } from "./api";
import {
  operationCommandSchema,
  operationLogStatusSchema,
} from "./operation-log";
import { registryIdSchema } from "./registry";

/** `limit` の既定値。 */
export const PAGINATION_DEFAULT_LIMIT = 20;
/** `limit` の上限（1 リクエストで返す最大件数）。 */
export const PAGINATION_MAX_LIMIT = 100;

/**
 * カーソルページングのクエリ（`?limit=50&cursor=...`）。
 * クエリ文字列から来るため `limit` は文字列も受け付ける（`z.coerce`）。
 * `cursor` は前ページの `nextCursor` をそのまま返す不透明な値で、
 * クライアントは中身を解釈しない。
 */
export const paginationQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION_MAX_LIMIT)
    .default(PAGINATION_DEFAULT_LIMIT),
  cursor: z.string().min(1).max(512).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** カーソルページングのレスポンス。次ページが無ければ `nextCursor` は `null`。 */
export interface PagedResponse<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * `{ items, nextCursor }` のレスポンススキーマを作る。
 * `nextCursor` は「次ページがある場合のみ」文字列で、最終ページでは `null`。
 */
export function pagedResponseSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

/** ISO 8601（`Date#toISOString()` 相当。オフセット表記も許容）。 */
const isoDateTimeSchema = z.iso.datetime({ offset: true });

/** `GET /logs/operations` の 1 件（§9.1 operation_logs / FR-15）。 */
export const operationLogItemSchema = z.object({
  id: z.uuid(),
  /** 記録日時（`created_at`）。 */
  at: isoDateTimeSchema,
  command: operationCommandSchema,
  registry: registryIdSchema,
  /** 対象ドメイン。`hello` / `poll` など対象を持たないコマンドは `null`。 */
  domainName: z.string().nullable(),
  status: operationLogStatusSchema,
  /** §10.3 の統一エラーコード。成功時は `null`。 */
  errorCode: apiErrorCodeSchema.nullable(),
  /** レジストリが返した結果コード（EPP result code 相当）。 */
  registryCode: z.string().nullable(),
  latencyMs: z.number().int().nonnegative(),
  /** `x-request-id`（clTRID と一致）。障害調査のキー（§9.1 / §10.2）。 */
  requestId: z.string().nullable(),
  /** 機密値（API キー・AuthCode）をマスク済みの送受信内容（AC-15-2）。 */
  request: z.unknown(),
  response: z.unknown(),
});
export type OperationLogItem = z.infer<typeof operationLogItemSchema>;

/** `GET /logs/operations` のレスポンス。 */
export const operationLogsResponseSchema = pagedResponseSchema(
  operationLogItemSchema,
);
export type OperationLogsResponse = z.infer<typeof operationLogsResponseSchema>;

/** `GET /logs/ai` の 1 件（§9.1 ai_logs / FR-14）。 */
export const aiLogItemSchema = z.object({
  id: z.uuid(),
  at: isoDateTimeSchema,
  feature: aiFeatureSchema,
  provider: aiProviderSchema,
  model: z.string(),
  /** 入力の要約（プロンプト全文は保存しない。AC-14-2）。 */
  inputSummary: z.string(),
  /** 構造化出力の要約（`output` から `summarizeForAiLog` で作る）。 */
  outputSummary: z.string(),
  status: aiLogStatusSchema,
  /** 失敗時のメッセージ。成功時は `null`。 */
  errorMessage: z.string().nullable(),
  latencyMs: z.number().int().nonnegative(),
  /** 取得できた場合のみのトークン数。表示用の合計は `aiTokenTotal` で導く。 */
  tokensIn: z.number().int().nonnegative().nullable(),
  tokensOut: z.number().int().nonnegative().nullable(),
  /** 生の構造化出力（画面で JSON として展開する）。 */
  output: z.unknown(),
});
export type AiLogItem = z.infer<typeof aiLogItemSchema>;

/** `GET /logs/ai` のレスポンス。 */
export const aiLogsResponseSchema = pagedResponseSchema(aiLogItemSchema);
export type AiLogsResponse = z.infer<typeof aiLogsResponseSchema>;
