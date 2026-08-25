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
 * レジストリ通信ログ（docs/requirements.md §9, FR-15/FR-18）。
 * EPP 相当コマンドの送受信を成功・失敗を問わずすべて記録する。
 * request / response は保存前に機密値（API キー・AuthCode）を *** にマスクすること（AC-15-2）。
 * 記録は RegistryClient ラッパー側の責務で、アダプタはログを意識しない（§11.1）。
 */
export const operationLogs = pgTable(
  "operation_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // ミドルウェアが採番する x-request-id（§10.2）
    requestId: text("request_id"),
    // kitaqsign / kitaqnic / mock
    registry: text("registry").notNull(),
    // check / info / create / renew / update / delete / restore / transfer / transferQuery / authCode
    command: text("command").notNull(),
    domainName: text("domain_name"),
    // success / error / timeout / spec_mismatch
    status: text("status").notNull(),
    // §10.3 の統一エラーコード（エラー時のみ）
    errorCode: text("error_code"),
    // レジストリが返したコード（EPP 結果コード相当）
    registryCode: text("registry_code"),
    // マスク済みの送受信内容
    request: jsonb("request"),
    response: jsonb("response"),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  // 一覧はユーザーごとの時系列表示（ページング）が基本なので複合インデックス
  (t) => [
    index("operation_logs_user_id_created_at_idx").on(t.userId, t.createdAt),
  ],
);
