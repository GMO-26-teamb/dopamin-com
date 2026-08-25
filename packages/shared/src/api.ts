import { z } from "zod";
import {
  domainNameSchema,
  hostNameSchema,
  sldSchema,
  tldSchema,
} from "./domain-name";
import { clientStatusSchema, registryIdSchema } from "./registry";

/** 統一エラーコード（docs/requirements.md §10.3）。 */
export const API_ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "OPERATION_NOT_ALLOWED",
  "REGISTRY_REJECTED",
  "REGISTRY_TIMEOUT",
  "REGISTRY_UNAVAILABLE",
  "REGISTRY_SPEC_MISMATCH",
  "AI_UNAVAILABLE",
  "RATE_LIMITED",
  "INTERNAL",
] as const;

export const apiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

/** 統一エラー形式（docs/requirements.md §10.3）。 */
export const apiErrorBodySchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
    registry: registryIdSchema.optional(),
    registryCode: z.string().optional(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;

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
