import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * 移管（docs/requirements.md §9, FR-12）。
 * 移管 IN / OUT の申請と進行状況を記録する。ドメインはまだ domains に無い場合が
 * ある（IN の申請中）ため、FK ではなく domain_name（FQDN）で持つ。
 */
export const transfers = pgTable(
  "transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    domainName: text("domain_name").notNull(),
    // kitaqsign / kitaqnic / mock
    registry: text("registry").notNull(),
    // in / out
    direction: text("direction").notNull(),
    // pending / approved / rejected / cancelled
    status: text("status").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // レジストリの生レスポンス
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("transfers_user_id_idx").on(t.userId)],
);
