import { z } from "zod";
import { registryIdSchema } from "./registry";

/**
 * 統一エラーコード（docs/requirements.md §10.3 v0.1.8: 基本 13 種 + FR-01 の 4 種）。
 * API のエラーレスポンスは必ずこの形で返す。
 *
 * ここが唯一の定義（issue #30 / #141）。`api.ts` にあった `ApiError*` 系の
 * 後方互換の別名 re-export は削除済みで、利用側はここの名前を直接使う。
 */
export const ERROR_CODES = [
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
  // FR-01 パスキー認証
  "CHALLENGE_NOT_FOUND",
  "VERIFICATION_FAILED",
  "CREDENTIAL_NOT_FOUND",
  "LAST_PASSKEY",
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

// エラーコード → HTTP ステータス（§10.3 / FR-01 spec §4）
export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  OPERATION_NOT_ALLOWED: 409,
  REGISTRY_REJECTED: 422,
  REGISTRY_TIMEOUT: 504,
  REGISTRY_UNAVAILABLE: 502,
  REGISTRY_SPEC_MISMATCH: 502,
  AI_UNAVAILABLE: 503,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  CHALLENGE_NOT_FOUND: 400,
  VERIFICATION_FAILED: 401,
  CREDENTIAL_NOT_FOUND: 401,
  LAST_PASSKEY: 409,
};

/**
 * 統一エラー形式（docs/requirements.md §10.3）。
 * `retryable` は必須（API は常に返す）。`details` はコードごとに形が違う
 * （`VALIDATION_ERROR` は issue の配列、`OPERATION_NOT_ALLOWED` は `{ statuses }` など）ので unknown。
 */
export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
    registry: registryIdSchema.optional(),
    registryCode: z.string().optional(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
