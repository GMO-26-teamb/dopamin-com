import { z } from "zod";
import { registryIdSchema } from "./registry";

/**
 * 移管一覧・詳細の API 契約（docs/requirements.md FR-12 / §9.1 / §10.1）。
 *
 * レジストリ由来の正規化型（`./registry.ts` の `TransferResult` / `TransferStatus`）とは
 * 別レイヤ。こちらは `transfers` テーブルの 1 行を画面に見せるための DTO で、
 * レジストリの生応答（`raw`）は含まない（FR-18 / ADR-0002）。
 */

/** 移管の向き（§9.1 `direction`）。`in` = 本アプリが gaining、`out` = 本アプリが losing。 */
export const transferDirectionSchema = z.enum(["in", "out"]);
export type TransferDirection = z.infer<typeof transferDirectionSchema>;

/**
 * `transfers.status`（§9.1）の値域。
 *
 * レジストリ側の {@link import("./registry").TransferStatus} が持つ `none`
 * （「移管中でない」。`transferQuery` が `info` から導出するため必要）は含まない。
 * DB には「移管の事実」だけが行として残り、`none` に相当する行は存在しないため。
 * 名前を `transferStatusSchema` にしないのは、正規化型の同名 export
 * （`./registry.ts`）と `packages/shared` のバレル export で衝突するからで、
 * 値域そのものは正規化型の真部分集合という関係を保っている。
 */
export const transferRecordStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);
export type TransferRecordStatus = z.infer<typeof transferRecordStatusSchema>;

/**
 * 移管 1 件の要約（`GET /transfers` / `GET /transfers/:id`。§10.1）。
 *
 * ドメインの識別は常に `domainName`（FQDN）が正で、`domainId` は紐付けられたら埋まる
 * 任意の参照（§9.1）。移管 IN は承認を検知して取り込むまで `domains` 行が無いため
 * `domainId` は null になる。
 */
export const transferSummarySchema = z.object({
  id: z.uuid(),
  domainName: z.string(),
  registry: registryIdSchema,
  direction: transferDirectionSchema,
  status: transferRecordStatusSchema,
  /** レジストリが返した移管状態の生値（trStatus 相当）。取れなければ省略。 */
  registryStatus: z.string().optional(),
  /** 相手レジストラ ID。`transferQuery` / Poll が返さない場合は省略。 */
  counterpartRegistrarId: z.string().optional(),
  /** 申請日時（ISO 8601）。レジストリが返さない場合は受理時刻で埋める。 */
  requestedAt: z.string().nullable(),
  /** 自動承認の期限（ISO 8601）。`actByAt` 無しなら `requestedAt` + 20 分（§9.2）。 */
  actByAt: z.string().nullable(),
  /** 承認 / 拒否 / 取消が確定した日時（ISO 8601）。pending の間は null。 */
  completedAt: z.string().nullable(),
  /** 紐付いた `domains` 行の ID。未取り込み・履歴のみの行は null。 */
  domainId: z.string().nullable(),
});
export type TransferSummary = z.infer<typeof transferSummarySchema>;

/**
 * `GET /transfers` のレスポンス（FR-12 / §10.1）。
 *
 * 画面（`/transfers`）が「移管 IN 申請中」「受信した OUT 申請」「履歴」の 3 区画で
 * 構成される（§20 の画面一覧）ので、その区画ごとに分けて返す。
 * - `inbound`: `direction = in` かつ `status = pending`（自分が出した申請）
 * - `outbound`: `direction = out` かつ `status = pending`（相手から受信した申請）
 * - `history`: 確定済み（approved / rejected / cancelled）の全行
 */
export const transfersListResponseSchema = z.object({
  inbound: z.array(transferSummarySchema),
  outbound: z.array(transferSummarySchema),
  history: z.array(transferSummarySchema),
});
export type TransfersListResponse = z.infer<typeof transfersListResponseSchema>;

/**
 * `GET /transfers/:id` などのパスパラメータ（§10.1）。
 * `transfers.id` は uuid（§9.1）。ドメイン名を渡す旧パスとの取り違えを型で弾く。
 */
export const transferIdParamSchema = z.uuid();

/**
 * Poll 消化の結果（`POST /registry/poll` の応答 / `POST /domains/sync` の内訳。§10.1）。
 *
 * Poll はレジストラ単位のキューでユーザーごとに分かれないため、件数も全体の値。
 * 反映先のユーザーは `domains` / `transfers` の行から引く（FR-12）。
 */
export const pollConsumeResultSchema = z.object({
  /** ack まで完了した通知の件数。 */
  processed: z.number().int().nonnegative(),
  /** 新しく作った `transfers` 行の件数（受信した移管申請）。 */
  created: z.number().int().nonnegative(),
  /** 確定（approved / rejected / cancelled）させた `transfers` 行の件数。 */
  settled: z.number().int().nonnegative(),
  /** 対応づけられず ack だけした通知の件数（未知種別・対象不明）。 */
  skipped: z.number().int().nonnegative(),
  /** レジストリ単位の失敗（1 つが落ちても他は消化する）。 */
  failures: z.array(
    z.object({ registry: registryIdSchema, message: z.string() }),
  ),
});
export type PollConsumeResult = z.infer<typeof pollConsumeResultSchema>;
