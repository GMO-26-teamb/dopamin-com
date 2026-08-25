import type { RegistryId } from "@dopamin/shared";

/**
 * アダプタが投げる正規化エラーのコード（docs/requirements.md §10.3 のサブセット）。
 * API 層はこのコードを HTTP ステータスへ変換する。
 */
export const REGISTRY_ERROR_CODES = [
  "NOT_FOUND",
  "CONFLICT",
  "OPERATION_NOT_ALLOWED",
  "REGISTRY_REJECTED",
  "REGISTRY_TIMEOUT",
  "REGISTRY_UNAVAILABLE",
  "REGISTRY_SPEC_MISMATCH",
] as const;

export type RegistryErrorCode = (typeof REGISTRY_ERROR_CODES)[number];

const RETRYABLE_CODES: ReadonlySet<RegistryErrorCode> = new Set([
  "REGISTRY_TIMEOUT",
  "REGISTRY_UNAVAILABLE",
]);

/** レジストリ通信の失敗を正規化した例外。レジストリ固有のコードは registryCode に保持する。 */
export class RegistryError extends Error {
  readonly code: RegistryErrorCode;
  readonly registry: RegistryId;
  /** レジストリが返した EPP result code（例: 2303）。 */
  readonly registryCode?: number;
  /** レジストリが返した人間向け詳細（UI にはそのまま出さない）。 */
  readonly reason?: string;
  readonly httpStatus?: number;

  constructor(options: {
    code: RegistryErrorCode;
    registry: RegistryId;
    message: string;
    registryCode?: number;
    reason?: string;
    httpStatus?: number;
    cause?: unknown;
  }) {
    super(
      options.message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "RegistryError";
    this.code = options.code;
    this.registry = options.registry;
    this.registryCode = options.registryCode;
    this.reason = options.reason;
    this.httpStatus = options.httpStatus;
  }

  get retryable(): boolean {
    return RETRYABLE_CODES.has(this.code);
  }
}

/** EPP result code → 正規化エラーコードの対応（RFC 5730 の意味論に準拠）。 */
export function errorCodeForEppResult(resultCode: number): RegistryErrorCode {
  switch (resultCode) {
    case 2302: // Object exists
      return "CONFLICT";
    case 2303: // Object does not exist
      return "NOT_FOUND";
    case 2304: // Object status prohibits operation
      return "OPERATION_NOT_ALLOWED";
    default:
      return "REGISTRY_REJECTED";
  }
}
