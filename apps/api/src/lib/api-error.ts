import type { ApiErrorCode } from "@dopamin/shared";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** ルート内で明示的に投げる業務エラー。errorHandler が §10.3 の統一形式に変換する。 */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
