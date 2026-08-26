import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { domains } from "./domains";
import { users } from "./users";

/**
 * 移管（docs/requirements.md §9, FR-12）。
 * 移管 IN / OUT の申請と進行状況を記録する。
 *
 * 申請中の IN はまだ domains に行が無い（承認検知 → info 取り込みの順で作る。§6.5）。
 * 移管 OUT が完了しても domains 行は `ownership = 'transferred_out'` で履歴として残す
 * （§6.5。ownership 列の追加は #33）が、レジストリから消滅したドメインの削除
 * （domain.service.ts の removeDomain）と FR-16 のデモリセットでは domains 行だけが消える。
 * そこでも移管の履歴は残したいので、ドメインの識別は常に domain_name（FQDN）が正で、
 * domain_id は「紐付けられたら埋める」任意の参照（ON DELETE SET NULL）にする。
 */
export const transfers = pgTable(
  "transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // IN は取り込み完了後に紐付け。OUT は申請受信時点の保有行（§9.1）
    domainId: uuid("domain_id").references(() => domains.id, {
      onDelete: "set null",
    }),
    domainName: text("domain_name").notNull(),
    // kitaqsign / kitaqnic / mock
    registry: text("registry").notNull(),
    // in（本アプリが gaining）/ out（本アプリが losing）
    direction: text("direction").notNull(),
    // pending / approved / rejected / cancelled。approved はサーバ自動承認を含む（§9.1）
    status: text("status").notNull(),
    // レジストリが返す移管状態の生値（trStatus 相当）。正規化で潰れた情報を残す
    // （TransferResult.registryStatus。ADR-0002）【要確認: §21.2 #13】
    registryStatus: text("registry_status"),
    // 相手レジストラ ID（Poll / transferQuery が返す場合）。
    // 正規化型の requestingRegistrarId / actingRegistrarId のうち自レジストラでない側を入れる（ADR-0002）
    counterpartRegistrarId: text("counterpart_registrar_id"),
    // 取り込み元の Poll メッセージ ID（PollMessage.id）。レジストリは int64 で返すが
    // 桁落ちを避けて text で持つ。UNIQUE(registry, registry_message_id) で二重処理を防ぐ
    registryMessageId: text("registry_message_id"),
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    // 自動承認期限（レジストリが返す acDate、無ければ requested_at + 20 分）
    actByAt: timestamp("act_by_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // 最後の transferQuery / Poll 応答（レジストリの生レスポンス）
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("transfers_user_id_idx").on(t.userId),
    // Poll 由来でない行は registry_message_id が NULL。Postgres の既定（NULLS DISTINCT）で
    // NULL 同士は衝突しないので、申請起点の行は何件でも入る
    unique("transfers_registry_message_id_uniq").on(
      t.registry,
      t.registryMessageId,
    ),
  ],
);
