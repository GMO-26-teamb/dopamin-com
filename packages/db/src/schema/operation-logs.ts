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
    // Poll 由来などシステム起点の呼び出し（/health の hello 等）は NULL（§9.1）。
    // 退会（users 削除）でも通信ログは恒久保存するため SET NULL にする。
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // X-Cl-TRID に送った値（clTRID）と一致させる（§9.1）
    requestId: text("request_id"),
    // レジストリ採番の svTRID（障害調査・他チームとの突合キー）
    svTrid: text("sv_trid"),
    // kitaqsign / kitaqnic / mock
    registry: text("registry").notNull(),
    // packages/shared の OPERATION_COMMANDS（主 15 種 + 補助 5 種 + アプリ内 1 種）が正（§9.1）
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
