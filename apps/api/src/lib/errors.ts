import { ERROR_STATUS, type ErrorCode } from "@dopamin/shared";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export interface ApiExceptionOptions {
  /** クライアントが同じリクエストを再送してよいか（§10.3 `retryable`）。既定 false。 */
  retryable?: boolean;
}

/**
 * 統一エラー（docs/requirements.md §10.3）。apps/api で明示的に投げる業務エラーはこれ 1 つ。
 * ルート・サービスからはこれを throw し、error-handler ミドルウェアが JSON に変換する。
 * HTTP ステータスは `ERROR_STATUS` から導出する（呼び出し側で status は指定しない）。
 * `details` はコードごとに形が違う（`VALIDATION_ERROR` は issue の配列、
 * `OPERATION_NOT_ALLOWED` は `{ statuses }` など）ので unknown。
 */
export class ApiException extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    options: ApiExceptionOptions = {},
  ) {
    super(message);
    this.name = "ApiException";
    this.retryable = options.retryable ?? false;
  }

  get status(): ContentfulStatusCode {
    return ERROR_STATUS[this.code] as ContentfulStatusCode;
  }
}
