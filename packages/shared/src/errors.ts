import { z } from "zod";

/**
 * 統一エラーコード（docs/requirements.md §10.3 + FR-01 spec §4 の追加分）。
 * API のエラーレスポンスは必ずこの形で返す。
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

export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    retryable: z.boolean().optional(),
    registry: z.string().optional(),
    registryCode: z.string().optional(),
    requestId: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
