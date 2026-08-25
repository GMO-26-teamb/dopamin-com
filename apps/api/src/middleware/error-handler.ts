import type { ErrorHandler } from "hono";
import { ApiException } from "../lib/errors";

/**
 * 例外を統一エラー形式（§10.3）に変換する。
 * 想定外のエラーは詳細を隠して 500 INTERNAL を返し、サーバーログにだけ出す。
 */
export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof ApiException) {
    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
      },
      err.status,
    );
  }
  console.error("[api] unhandled error:", err);
  return c.json(
    {
      error: {
        code: "INTERNAL",
        message: "サーバー内部でエラーが発生しました。",
      },
    },
    500,
  );
};
