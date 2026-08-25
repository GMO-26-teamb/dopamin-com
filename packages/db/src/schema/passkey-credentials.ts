import {
  bigint,
  boolean,
  customType,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

// Drizzle に bytea の組み込み型が無いため定義する。postgres.js は Uint8Array/Buffer をそのまま扱える
const bytea = customType<{ data: Uint8Array }>({
  dataType() {
    return "bytea";
  },
});

/**
 * パスキー資格情報（docs/requirements.md §9, docs/specs FR-01 §7）。
 * - id は SimpleWebAuthn が返す credential ID（base64url 文字列）をそのまま PK にする
 * - public_key は登録後に更新しない（改竄検出のため。更新するのは counter / name / last_used_at のみ）
 */
export const passkeyCredentials = pgTable(
  "passkey_credentials",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // COSE 公開鍵
    publicKey: bytea("public_key").notNull(),
    // signature counter。多くのプラットフォーム認証器は常に 0 を返す点に注意（FR-01 spec §7 の拒否条件参照）
    counter: bigint("counter", { mode: "number" }).notNull(),
    // internal / hybrid 等
    transports: text("transports").array(),
    // singleDevice / multiDevice
    deviceType: text("device_type"),
    backedUp: boolean("backed_up"),
    aaguid: text("aaguid"),
    // 表示用（AAGUID から推定 or ユーザー指定）
    name: text("name"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("passkey_credentials_user_id_idx").on(t.userId)],
);
