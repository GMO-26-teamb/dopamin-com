import { ERROR_STATUS, type ErrorCode } from "@dopamin/shared";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * 統一エラー（docs/requirements.md §10.3）。
 * ルート・サービスからはこれを throw し、error-handler ミドルウェアが JSON に変換する。
 */
export class ApiException extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiException";
  }

  get status(): ContentfulStatusCode {
    return ERROR_STATUS[this.code] as ContentfulStatusCode;
  }
}
