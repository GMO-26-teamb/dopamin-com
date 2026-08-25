import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * ユーザー（docs/requirements.md §9）。
 * 認証方式（パスキー / パスワード）がチームで未確定のため、方式に依存しない最小構成で定義する。
 * passkey_credentials / webauthn_challenges は認証方式の確定後に追加する。
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: text("display_name").notNull(),
  // AI 設定（FR-17）。NULL のときは環境変数の既定値を使う
  aiProvider: text("ai_provider"),
  aiModel: text("ai_model"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
