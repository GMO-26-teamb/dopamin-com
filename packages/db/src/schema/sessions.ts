import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * セッション（docs/requirements.md §9, §12.3）。
 * id は 32 byte ランダムの不透明トークン（base64url）で、そのまま Cookie 値になる。
 * ログイン方式が何であれ「検証成功 → セッション発行」の形は変わらないため、先に定義してよい。
 */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 7 日。アクセス時に残り 3 日を切っていたら延長する（§10.2 session ミドルウェア）
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);
