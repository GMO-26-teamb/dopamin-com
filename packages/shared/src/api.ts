import { z } from "zod";
import {
  domainNameSchema,
  hostNameSchema,
  sldSchema,
  tldSchema,
} from "./domain-name";
import { errorCodeSchema } from "./errors";
import {
  clientStatusSchema,
  registryIdSchema,
  type TransferResult,
  transferStatusSchema,
} from "./registry";
import { transferDirectionSchema } from "./transfers";

/**
 * 統一エラー（docs/requirements.md §10.3）の定義は `./errors.ts` が正（issue #30）。
 * 以下は後方互換の別名。新しいコードは `ERROR_CODES` / `errorCodeSchema` / `ErrorCode` /
 * `apiErrorSchema` / `ApiError` を直接使うこと。
 */
export type {
  ApiError as ApiErrorBody,
  ErrorCode as ApiErrorCode,
} from "./errors";
export {
  apiErrorSchema as apiErrorBodySchema,
  ERROR_CODES as API_ERROR_CODES,
  errorCodeSchema as apiErrorCodeSchema,
} from "./errors";

/** `POST /domains/check` の入力（FR-03）。SLD + TLD 群、または FQDN 群のどちらか。 */
export const domainCheckRequestSchema = z.union([
  z.object({
    sld: sldSchema,
    tlds: z.array(tldSchema).min(1).max(22),
  }),
  z.object({
    names: z.array(domainNameSchema).min(1).max(20),
  }),
]);
export type DomainCheckRequest = z.infer<typeof domainCheckRequestSchema>;

export const domainAvailabilitySchema = z.enum([
  "available",
  "unavailable",
  "error",
]);
export type DomainAvailability = z.infer<typeof domainAvailabilitySchema>;

/** `POST /domains` の入力（FR-06）。 */
export const domainCreateRequestSchema = z.object({
  name: domainNameSchema,
  /** 登録期間（年）。既定 1 年。 */
  period: z.number().int().min(1).max(10).default(1),
  nameservers: z.array(hostNameSchema).max(13).optional(),
});
export type DomainCreateRequest = z.infer<typeof domainCreateRequestSchema>;

/** `POST /domains/:name/renew` の入力（FR-08）。 */
export const domainRenewRequestSchema = z.object({
  period: z.number().int().min(1).max(10),
});
export type DomainRenewRequest = z.infer<typeof domainRenewRequestSchema>;

/** `PATCH /domains/:name` の入力（FR-09）。nameservers は「変更後の全量」を渡す。 */
export const domainUpdateRequestSchema = z
  .object({
    nameservers: z
      .array(hostNameSchema)
      .max(13)
      .refine((v) => v.length === 0 || v.length >= 2, {
        message:
          "ネームサーバは 0 件（全解除）または 2〜13 件で指定してください",
      })
      .optional(),
    clientStatuses: z
      .object({
        add: z.array(clientStatusSchema).optional(),
        remove: z.array(clientStatusSchema).optional(),
      })
      .optional(),
  })
  .refine(
    (v) => v.nameservers !== undefined || v.clientStatuses !== undefined,
    {
      message: "変更内容を 1 つ以上指定してください",
    },
  );
export type DomainUpdateRequest = z.infer<typeof domainUpdateRequestSchema>;

/** `POST /transfers` の入力（FR-12 移管 IN）。 */
export const transferCreateRequestSchema = z.object({
  name: domainNameSchema,
  authCode: z.string().min(1).max(64),
});
export type TransferCreateRequest = z.infer<typeof transferCreateRequestSchema>;

/**
 * `POST /transfers` が返す移管情報（FR-12）。
 *
 * 正規化型 {@link TransferResult} から `raw`（レジストリの生応答）を除いたもの。
 * レジストリの生の出力は画面に流さない方針（FR-18 / NFR-03）に合わせ、API 境界で剥がす
 * （ADR-0002）。web もこのスキーマで応答を検証する（形の二重定義を作らない）。
 *
 * 一覧・状態照会（`GET /transfers` / `GET /transfers/:id`）はレジストリ応答ではなく
 * `transfers` 行を返すので、そちらは `./transfers.ts` の `transferSummarySchema` が正。
 */
export const transferResponseSchema = z.object({
  name: z.string(),
  status: transferStatusSchema,
  registryStatus: z.string().optional(),
  requestingRegistrarId: z.string().optional(),
  actingRegistrarId: z.string().optional(),
  requestedAt: z.string().optional(),
  actByAt: z.string().optional(),
  newExpiresAt: z.string().optional(),
});
export type TransferResponse = z.infer<typeof transferResponseSchema>;

/** 正規化結果 → API 応答。`raw` を落とすだけの純関数（分割代入せず明示的に組み立てる）。 */
export function toTransferResponse(result: TransferResult): TransferResponse {
  return {
    name: result.name,
    status: result.status,
    registryStatus: result.registryStatus,
    requestingRegistrarId: result.requestingRegistrarId,
    actingRegistrarId: result.actingRegistrarId,
    requestedAt: result.requestedAt,
    actByAt: result.actByAt,
    newExpiresAt: result.newExpiresAt,
  };
}

/**
 * §9.1 の所有権。`transferred_out`（移管 OUT 完了）は表示のみで全操作不可（AC-12-5）。
 */
export const ownershipSchema = z.enum(["owned", "transferred_out"]);
export type Ownership = z.infer<typeof ownershipSchema>;

/** 進行中の移管（FR-12）。`actByAt` はサーバ自動承認の期限（申請 + 20 分）。 */
export const domainTransferBadgeSchema = z.object({
  direction: transferDirectionSchema,
  actByAt: z.string(),
});

/**
 * 保有ドメイン 1 件の要約（`GET /domains` / `POST /domains/sync`。FR-02）。
 *
 * 表示ステータスは含めない。EPP ステータスの解釈は `deriveDisplayStatus` が SSOT で、
 * API・Web の双方がこの要約を入力にして同じ結果を導出する（web 側の ViewModel は
 * これに `displayStatus` を足したもの）。
 */
export const domainSummarySchema = z.object({
  name: z.string(),
  sld: z.string(),
  tld: z.string(),
  registry: registryIdSchema,
  statuses: z.array(z.string()),
  rgpStatuses: z.array(z.string()),
  ownership: ownershipSchema,
  registeredAt: z.string(),
  expiresAt: z.string().nullable(),
  rgpUntil: z.string().nullable(),
  /** 最後にレジストリと同期できた時刻（ISO 8601）。 */
  syncedAt: z.string(),
  /** true = 直近の同期に失敗し DB キャッシュを表示している（AC-07-2）。 */
  stale: z.boolean(),
  /**
   * 進行中の移管のバッジ。移管 IN は `domains` 行を持たないため（§6.5）ここには出ず、
   * 出るのは移管 OUT（Poll で `transfers(out)` を作る #58）だけ。その生産者が入るまで常に null。
   */
  transfer: domainTransferBadgeSchema.nullable(),
});
export type DomainSummary = z.infer<typeof domainSummarySchema>;

/** `GET /domains` のレスポンス（FR-02）。 */
export const domainListResponseSchema = z.object({
  domains: z.array(domainSummarySchema),
});
export type DomainListResponse = z.infer<typeof domainListResponseSchema>;

/** `POST /domains/sync` で同期できなかったドメイン（部分失敗を許容する）。 */
export const domainSyncFailureSchema = z.object({
  name: z.string(),
  code: errorCodeSchema,
  message: z.string(),
});

/** `POST /domains/sync` のレスポンス（FR-02）。失敗した行は stale: true で返る。 */
export const domainSyncResponseSchema = z.object({
  domains: z.array(domainSummarySchema),
  failures: z.array(domainSyncFailureSchema),
});
export type DomainSyncResponse = z.infer<typeof domainSyncResponseSchema>;
