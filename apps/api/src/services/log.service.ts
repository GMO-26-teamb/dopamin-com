import { type Db, schema } from "@dopamin/db";
import {
  type AiLogItem,
  aiLogItemSchema,
  type OperationLogItem,
  operationLogItemSchema,
  type PagedResponse,
  type PaginationQuery,
  summarizeForAiLog,
} from "@dopamin/shared";
import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { ZodType } from "zod";
import { ApiException } from "../lib/errors";

/**
 * ログ一覧（docs/requirements.md §10.1 `GET /logs/operations`・`GET /logs/ai` / FR-14・FR-15）。
 *
 * どちらも `user_id` で絞った `created_at DESC` のカーソルページング。同一 API リクエスト内の
 * 複数呼び出しは `created_at` が同着になり得るので、タイブレークに `id` を含めた
 * 複合カーソル `(created_at, id)` で辿る（§10.1「created_at + id」）。
 */

/** カーソルの内部表現。クライアントには base64url 文字列としてだけ見せる。 */
interface LogCursor {
  at: Date;
  id: string;
}

/** カーソル文字列の区切り（ISO 8601 にも UUID にも現れない文字）。 */
const CURSOR_SEPARATOR = "|";

/** `(created_at, id)` を不透明な文字列に畳む。 */
export function encodeLogCursor(cursor: LogCursor): string {
  return Buffer.from(
    `${cursor.at.toISOString()}${CURSOR_SEPARATOR}${cursor.id}`,
    "utf8",
  ).toString("base64url");
}

/**
 * カーソル文字列を `(created_at, id)` に戻す。
 * 壊れた値を握りつぶして先頭ページを返すと「同じページが無限に返る」ため、
 * 復元できなければ VALIDATION_ERROR で明示的に弾く。
 */
export function decodeLogCursor(cursor: string): LogCursor {
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const separator = raw.indexOf(CURSOR_SEPARATOR);
  const parsedAt = new Date(separator === -1 ? "" : raw.slice(0, separator));
  const id = separator === -1 ? "" : raw.slice(separator + 1);
  if (id === "" || Number.isNaN(parsedAt.getTime())) {
    throw new ApiException("VALIDATION_ERROR", "cursor の形式が不正です。");
  }
  return { at: parsedAt, id };
}

/**
 * `(created_at, id) < (cursor.at, cursor.id)` の行だけに絞る条件。
 * drizzle は行値比較（row constructor）を組めないので、同着時のタイブレークを OR で展開する。
 */
function beforeCursor(
  createdAt: PgColumn,
  id: PgColumn,
  cursor: LogCursor,
): SQL | undefined {
  return or(
    lt(createdAt, cursor.at),
    and(eq(createdAt, cursor.at), lt(id, cursor.id)),
  );
}

/**
 * 行を API の 1 件に写す。値域を持つ列（`command` / `status` など）は text なので、
 * 契約スキーマに通らない行はページ全体を 500 にせず、その行だけ落として警告を出す
 * （語彙を狭める変更のあとも過去ログのせいで一覧が壊れないようにするため）。
 */
function parseRow<T>(
  itemSchema: ZodType<T>,
  value: unknown,
  id: string,
): T | null {
  const result = itemSchema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  console.warn(JSON.stringify({ level: "warn", type: "log_row_skipped", id }));
  return null;
}

/**
 * `limit + 1` 件読んで「次ページがあるか」を判定し、余分の 1 件は捨てる。
 * 次のカーソルは「読んだ最後の行」から作るので、`parseRow` が落とした行があっても
 * ページの継ぎ目はずれない。
 */
function toPage<Row extends { id: string; createdAt: Date }, Item>(
  rows: Row[],
  limit: number,
  toItem: (row: Row) => Item | null,
): PagedResponse<Item> {
  const hasNext = rows.length > limit;
  const page = hasNext ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  return {
    items: page.flatMap((row) => {
      const item = toItem(row);
      return item === null ? [] : [item];
    }),
    nextCursor:
      hasNext && last !== undefined
        ? encodeLogCursor({ at: last.createdAt, id: last.id })
        : null,
  };
}

/** operation_logs の行 → 1 件（request / response はマスク済みをそのまま返す。AC-15-2）。 */
function toOperationLogItem(
  row: typeof schema.operationLogs.$inferSelect,
): OperationLogItem | null {
  return parseRow(
    operationLogItemSchema,
    {
      id: row.id,
      at: row.createdAt.toISOString(),
      command: row.command,
      registry: row.registry,
      domainName: row.domainName,
      status: row.status,
      errorCode: row.errorCode,
      registryCode: row.registryCode,
      latencyMs: row.latencyMs ?? 0,
      requestId: row.requestId,
      request: row.request,
      response: row.response,
    },
    row.id,
  );
}

/**
 * ai_logs の行 → 1 件。`outputSummary` に対応する列は持たず、保存済みの構造化出力から
 * 読み出し時に作る（保存するのは要約 + 構造化出力だけ、という AC-14-2 の形に合わせる）。
 */
function toAiLogItem(row: typeof schema.aiLogs.$inferSelect): AiLogItem | null {
  return parseRow(
    aiLogItemSchema,
    {
      id: row.id,
      at: row.createdAt.toISOString(),
      feature: row.feature,
      provider: row.provider,
      model: row.model,
      inputSummary: row.inputSummary ?? "",
      outputSummary: row.output === null ? "" : summarizeForAiLog(row.output),
      status: row.status,
      errorMessage: row.errorMessage,
      latencyMs: row.latencyMs ?? 0,
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      output: row.output,
    },
    row.id,
  );
}

/** FR-15: 自分の操作ログを新しい順に 1 ページ分返す。 */
export async function listOperationLogs(
  db: Db,
  userId: string,
  query: PaginationQuery,
): Promise<PagedResponse<OperationLogItem>> {
  const { operationLogs } = schema;
  const cursor =
    query.cursor === undefined ? null : decodeLogCursor(query.cursor);
  const rows = await db
    .select()
    .from(operationLogs)
    .where(
      and(
        // 他ユーザーの行と、システム起点（user_id NULL）の行は見せない（NFR-04）
        eq(operationLogs.userId, userId),
        ...(cursor === null
          ? []
          : [beforeCursor(operationLogs.createdAt, operationLogs.id, cursor)]),
      ),
    )
    .orderBy(desc(operationLogs.createdAt), desc(operationLogs.id))
    .limit(query.limit + 1);
  return toPage(rows, query.limit, toOperationLogItem);
}

/** FR-14: 自分の AI ログを新しい順に 1 ページ分返す。 */
export async function listAiLogs(
  db: Db,
  userId: string,
  query: PaginationQuery,
): Promise<PagedResponse<AiLogItem>> {
  const { aiLogs } = schema;
  const cursor =
    query.cursor === undefined ? null : decodeLogCursor(query.cursor);
  const rows = await db
    .select()
    .from(aiLogs)
    .where(
      and(
        eq(aiLogs.userId, userId),
        ...(cursor === null
          ? []
          : [beforeCursor(aiLogs.createdAt, aiLogs.id, cursor)]),
      ),
    )
    .orderBy(desc(aiLogs.createdAt), desc(aiLogs.id))
    .limit(query.limit + 1);
  return toPage(rows, query.limit, toAiLogItem);
}
