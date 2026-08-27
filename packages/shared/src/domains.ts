import { z } from "zod";
import { domainSummarySchema } from "./api";
import { errorCodeSchema } from "./errors";
import { registrantProfileSchema, registryIdSchema } from "./registry";

/**
 * ドメイン詳細（`GET /domains/:name`。FR-07 / AC-07-2 / §6.5）の API 契約。
 *
 * 一覧の要約（`domainSummarySchema`）は `api.ts` に、レジストリ正規化型の
 * `DomainInfo`（interface）は `registry.ts` にある。ここはその 2 つを束ねた
 * 「詳細レスポンスの形」だけを持つ。
 */

/**
 * `DomainInfo`（`registry.ts` の正規化型）のワイヤ表現。
 *
 * `registry.ts` 側が interface なのは、アダプタ実装が組み立てる値だから
 * （入力ではないので実行時検証が要らない）。API 境界を越えるときは
 * クライアントが検証できる必要があるので、ここで zod にする。
 * どちらかを変えたら両方を合わせる（型の食い違いは `toDomainInfoSchema` の
 * 単体テストで検出する）。
 */
export const domainInfoSchema = z.object({
  name: z.string(),
  registry: registryIdSchema,
  statuses: z.array(z.string()),
  registrant: z.string(),
  contacts: z.record(z.string(), z.string()),
  nameservers: z.array(z.string()),
  registeredAt: z.string(),
  updatedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  lastTransferAt: z.string().nullable(),
  sponsoringRegistrarId: z.string().nullable(),
  rgpStatuses: z.array(z.string()),
});
export type DomainInfoResponse = z.infer<typeof domainInfoSchema>;

/**
 * キャッシュを返した理由（AC-07-2）。`stale: true` のときだけ付く。
 * レジストリに繋がらなかったこと自体は失敗ではない（200 で返す）が、
 * 画面が「いつの情報か」と「なぜ最新でないか」を出せるように理由を添える。
 */
export const domainStaleReasonSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
});

/**
 * `GET /domains/:name` などのレスポンス（FR-07）。
 *
 * - `domain`: 正規化済み `info`（レジストリが正。§6.5）
 * - `summary`: 一覧と同じ要約。所有権・移管バッジ・同期時刻はここから読む
 * - `registrantProfile`: 登録者コンタクトの中身（FR-07 の「登録者コンタクト（ダミー）」表示用）
 * - `stale`: true = レジストリに繋がらず DB キャッシュを返した（AC-07-2）
 * - `error`: `stale` の理由。繋がった場合は付かない
 *
 * **`displayStatus` と `transferEligibleAt` は含めない。** どちらも
 * この応答から一意に導出できる値で、`deriveDisplayStatus` /`transferEligibleAt`
 * （`packages/shared`）が導出の SSOT。API が計算済みの値も返すと
 * 「API の値」と「画面が導出した値」の 2 系統ができ、片方だけ直る事故になる
 * （`domainSummarySchema` が表示ステータスを持たないのと同じ理由）。
 */
export const domainDetailResponseSchema = z.object({
  domain: domainInfoSchema,
  summary: domainSummarySchema,
  /**
   * `domain.registrant`（レジストリのコンタクト ID）が指す登録者プロファイル。
   *
   * レジストリの `info` は ID しか返さないので、画面が氏名・メールを出すには
   * アプリが `contacts` に持っている中身を添える必要がある（FR-07 / FR-09）。
   * **そのドメインが実際にアプリのコンタクトを参照しているときだけ**値が入る。
   * 移管 IN 直後のように相手レジストラの ID を参照したままなら `null`
   * （中身を知らないため。非スポンサーの `contact info` 可否は要確認 #14）。
   */
  registrantProfile: registrantProfileSchema.nullable(),
  stale: z.boolean(),
  /** 最後にレジストリと同期できた時刻（ISO 8601）。 */
  syncedAt: z.string(),
  error: domainStaleReasonSchema.optional(),
});
export type DomainDetailResponse = z.infer<typeof domainDetailResponseSchema>;

/**
 * `DELETE /domains/:name` のレスポンス（FR-10）。
 * 即時削除でレジストリから消えた場合は `domain` / `summary` とも null になる。
 */
export const domainDeleteResponseSchema = z.object({
  domain: domainInfoSchema.nullable(),
  summary: domainSummarySchema.nullable(),
  stale: z.boolean(),
});
export type DomainDeleteResponse = z.infer<typeof domainDeleteResponseSchema>;
