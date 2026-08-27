import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * AI 呼び出しログ（docs/requirements.md §9.1 ai_logs / §13.4, FR-14）。
 * 生成 AI の呼び出しを成功・失敗を問わずすべて記録する（AC-14-1）。
 *
 * プロンプト全文は保存せず、`input_summary`（200 字以内）と構造化出力だけを残す（AC-14-2）。
 * 要約の生成は packages/shared の `summarizeForAiLog` が担い、長さの担保もそこで行う。
 * 記録は apps/api の ai-log.service が担当し、AI 呼び出し側はログを意識しない。
 */
export const aiLogs = pgTable(
  "ai_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // AI ログは本人だけが見る画面用のデータ（§15 `/logs` の AI タブ）なので、
    // 恒久保存する operation_logs（SET NULL）とは違い退会時に一緒に消す
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // packages/shared の AI_FEATURES（domain_candidates / uniqueness / subdomain_plan）が正
    feature: text("feature").notNull(),
    // packages/shared の AI_PROVIDERS（google / anthropic / xai）が正。フォールバック後は実際に応答した側
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    // 入力の要約（200 字以内。プロンプト全文は保存しない。AC-14-2）
    inputSummary: text("input_summary"),
    // zod で再検証済みの構造化出力（失敗時は NULL）
    output: jsonb("output"),
    // プロバイダが返した場合のみ。取得できなければ NULL
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    latencyMs: integer("latency_ms"),
    // packages/shared の AI_LOG_STATUSES（success / error）が正
    status: text("status").notNull(),
    // 失敗時のメッセージ（成功時は NULL）
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  // 一覧はユーザーごとの時系列表示（ページング）が基本なので複合インデックス
  (t) => [index("ai_logs_user_id_created_at_idx").on(t.userId, t.createdAt)],
);
