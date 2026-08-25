import type { ErrorHandler } from "hono";
import { ApiException } from "../lib/errors";
import type { RequestIdVariables } from "./request-id";

/**
 * 例外を統一エラー形式（§10.3）に変換する。
 * 想定外のエラーは詳細を隠して 500 INTERNAL を返し、サーバーログにだけ出す（requestId で突合できる）。
 */
export const errorHandler: ErrorHandler<{ Variables: RequestIdVariables }> = (
  err,
  c,
) => {
  const requestId = c.get("requestId");
  if (err instanceof ApiException) {
    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
          ...(requestId ? { requestId } : {}),
          ...(err.details ? { details: err.details } : {}),
        },
      },
      err.status,
    );
  }
  console.error(`[api] unhandled error (requestId=${requestId ?? "-"}):`, err);
  return c.json(
    {
      error: {
        code: "INTERNAL",
        message: "サーバー内部でエラーが発生しました。",
        ...(requestId ? { requestId } : {}),
      },
    },
    500,
  );
};
