import { createMiddleware } from "hono/factory";
import { runWithRequestContext } from "../lib/operation-log-context";
import type { AppEnv } from "../types";

/**
 * 操作ログ（FR-15）用のリクエストコンテキスト（AsyncLocalStorage）。
 * requestId ミドルウェアの直後に適用し、以降の処理（レジストリ呼び出し含む）を
 * 同一コンテキストで包む。userId は requireSession が後から補完する。
 */
export const requestContext = createMiddleware<AppEnv>(async (c, next) => {
  await runWithRequestContext(c.get("requestId"), () => next());
});
