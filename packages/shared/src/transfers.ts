import { z } from "zod";
import { registryIdSchema, transferStatusSchema } from "./registry";

/**
 * 移管一覧（FR-12。`GET /transfers` / `GET /transfers/:id`）の API 契約。
 *
 * `./registry.ts` の {@link transferStatusSchema} / `TransferResult` は
 * 「レジストリ応答の正規化結果」の語彙で、こちらは「`transfers` テーブル（§9.1）に
 * 永続化された 1 件」の語彙。前者は移管中でないことを表す `none` を持ち、後者は持たない
 * （行が存在すること自体が「移管があった」ことを意味するため）。値域がずれないよう、
 * 後者は前者から `none` を除いて導出する。
 */

/** 移管の向き（§9.1 `transfers.direction`）。`in` = 本アプリが gaining、`out` = losing。 */
export const TRANSFER_DIRECTIONS = ["in", "out"] as const;

export const transferDirectionSchema = z.enum(TRANSFER_DIRECTIONS);
export type TransferDirection = z.infer<typeof transferDirectionSchema>;

/**
 * 永続化された移管のステータス（§9.1 `transfers.status`）。
 * `approved` はサーバ自動承認（放置 20 分）を含む。
 */
export const transferRecordStatusSchema = transferStatusSchema.exclude([
  "none",
]);
export type TransferRecordStatus = z.infer<typeof transferRecordStatusSchema>;

/** 値域の一覧（テスト・網羅チェック用）。 */
export const TRANSFER_RECORD_STATUSES = transferRecordStatusSchema.options;

/** `GET /transfers/:id` のパスパラメータ。`transfers.id`（uuid）。 */
export const transferIdParamSchema = z.uuid();

/**
 * 移管 1 件の要約（§9.1 の `transfers` 行の射影）。
 *
 * `raw`（レジストリ生応答）と `registry_message_id`（Poll の内部 ID）は載せない
 * （FR-18 / NFR-03。生の出力は画面に流さない）。
 * DB 由来で欠けうる値はすべて `null` で表す（`undefined` との使い分けを作らない）。
 */
export const transferSummarySchema = z.object({
  id: z.uuid(),
  domainName: z.string(),
  registry: registryIdSchema,
  direction: transferDirectionSchema,
  status: transferRecordStatusSchema,
  /** レジストリが返した移管状態の生値（trStatus 相当）【要確認: §21.2 #13】。 */
  registryStatus: z.string().nullable(),
  /** 相手レジストラ ID。`info` からは取れないため実レジストリでは当面 null（ADR-0002）。 */
  counterpartRegistrarId: z.string().nullable(),
  /** 申請日時（ISO 8601）。行の作成時に必ず入れる。 */
  requestedAt: z.string(),
  /** サーバ自動承認の期限（ISO 8601）。`requestedAt` + 20 分（§9.2）。 */
  actByAt: z.string().nullable(),
  /** 完了（承認 / 拒否 / 取消）を検知した日時。進行中は null。 */
  completedAt: z.string().nullable(),
  /**
   * 紐付いた `domains` 行の id。移管 IN は承認を検知して取り込むまで null（§6.5）。
   * `status = "approved"` かつ null は「取り込み待ち」で、次回の一覧表示で再試行される。
   */
  domainId: z.uuid().nullable(),
});
export type TransferSummary = z.infer<typeof transferSummarySchema>;

/**
 * `GET /transfers` のレスポンス（FR-12 / §10.1）。
 *
 * - `inbound`: 進行中の移管 IN。`pending` に加え、承認済みで取り込み待ち
 *   （`approved` かつ `domainId` が null）の行も進行中として扱う。
 * - `outbound`: 受信した移管 OUT の申請（`pending`）。生産者は Poll（#58）なので本 API では当面空。
 * - `history`: 完了・拒否・取消。
 */
export const transfersListResponseSchema = z.object({
  inbound: z.array(transferSummarySchema),
  outbound: z.array(transferSummarySchema),
  history: z.array(transferSummarySchema),
});
export type TransfersListResponse = z.infer<typeof transfersListResponseSchema>;

/** `GET /transfers/:id` のレスポンス。 */
export const transferDetailResponseSchema = z.object({
  transfer: transferSummarySchema,
});
export type TransferDetailResponse = z.infer<
  typeof transferDetailResponseSchema
>;

/**
 * 移管 1 件を `GET /transfers` の 3 バケットのどれに入れるかを決める（SSOT）。
 * API・Web の双方がこの関数で同じ結果を導出する（`deriveDisplayStatus` と同じ流儀）。
 */
export function transferBucket(
  transfer: Pick<TransferSummary, "direction" | "status" | "domainId">,
): "inbound" | "outbound" | "history" {
  const inProgress =
    transfer.status === "pending" ||
    // 承認済みだが `domains` への取り込みが済んでいない（§6.5 の再試行対象）
    (transfer.status === "approved" &&
      transfer.direction === "in" &&
      transfer.domainId === null);
  if (!inProgress) {
    return "history";
  }
  return transfer.direction === "in" ? "inbound" : "outbound";
}
