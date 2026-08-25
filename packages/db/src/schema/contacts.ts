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
 * 登録者プロファイル（docs/requirements.md §9）。
 * PII は許可されたダミー値のみ（例: name = "Dopamin Demo User", email = "<user_id>@example.invalid"）。
 * 実在の個人情報を保存してはならない。
 */
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // レジストリ側にコンタクトを登録した場合の紐付け（thick モデル）
    registry: text("registry"),
    registryContactId: text("registry_contact_id"),
    // registrant / tech（admin / billing は扱わない。ICANN Registration Data Policy 準拠）
    role: text("role").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    org: text("org"),
    // レジストリに送った生データ（住所等のダミー）
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("contacts_user_id_idx").on(t.userId)],
);
