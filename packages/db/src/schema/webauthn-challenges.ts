import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * WebAuthn チャレンジ（docs/requirements.md §9, docs/specs FR-01 §7）。
 * Vercel Functions はリクエストごとに別インスタンスになりうるため、チャレンジはメモリではなく DB に持つ。
 * 1 回限り・5 分失効。検証成功時に必ず削除する。
 *
 * user_id に FK を張らない理由: サインアップ時は users 行を作る前に ID だけ事前採番して
 * ここに保存するため（verify 成功時に初めて users を INSERT する。FR-01 spec §3.1）。
 */
export const webauthnChallenges = pgTable("webauthn_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  // base64url
  challenge: text("challenge").notNull(),
  // registration / authentication
  type: text("type").notNull(),
  // 登録時は事前採番したユーザー ID（未作成）。ログイン時は NULL
  userId: uuid("user_id"),
  // 登録時のみ
  displayName: text("display_name"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
