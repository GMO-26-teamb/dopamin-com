import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * 保有ドメイン（docs/requirements.md §9）。
 * レジストリが正（Source of Truth）で、このテーブルは「ユーザーとの紐付け + 表示用キャッシュ + 同期時刻」。
 * ドメインの状態は info の結果で上書きし、raw_info に最後のレスポンスを保持する（§6.5）。
 */
export const domains = pgTable(
  "domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // FQDN 小文字（例: "takutaku.com"）。保有中（ownership = 'owned'）の行についてのみ一意（§9.1）
    name: text("name").notNull(),
    sld: text("sld").notNull(),
    // ドットなし（例: "com"）
    tld: text("tld").notNull(),
    // kitaqsign / kitaqnic / mock
    registry: text("registry").notNull(),
    // レジストリ側 ID（ROID 相当）があれば
    registryRef: text("registry_ref"),
    // owned / transferred_out（§6.5）。移管 OUT 完了後も行は履歴として残す
    ownership: text("ownership").notNull().default("owned"),
    // info の clID（現スポンサーレジストラ）。両 OpenAPI に clID が無いため当面 null（§11.1 / ADR-0002）
    sponsoringRegistrarId: text("sponsoring_registrar_id"),
    // 移管 OUT 完了を検知した日時
    transferredOutAt: timestamp("transferred_out_at", { withTimezone: true }),
    // EPP ステータス（§11.3）。表示バッジ・操作可否はここから導出する
    statuses: text("statuses").array().notNull(),
    nameservers: text("nameservers")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // レジストリの crDate / exDate
    registeredAt: timestamp("registered_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    // 移管 60 日ルール（§9.2 transferEligibleAt）用
    lastTransferAt: timestamp("last_transfer_at", { withTimezone: true }),
    // redemptionPeriod / pendingDelete / NULL
    rgpStatus: text("rgp_status"),
    rgpUntil: timestamp("rgp_until", { withTimezone: true }),
    // 最後の info レスポンス（正規化前の生データ）
    rawInfo: jsonb("raw_info"),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("domains_user_id_idx").on(t.userId),
    // 保有中の行だけを一意にする。移管 OUT 済みの行を残したまま同名を再取得・再移管 IN できる（AC-12-5）
    uniqueIndex("domains_name_owned_uniq")
      .on(t.name)
      .where(sql`${t.ownership} = 'owned'`),
  ],
);
