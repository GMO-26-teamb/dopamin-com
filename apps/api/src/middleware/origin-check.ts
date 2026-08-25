import { createMiddleware } from "hono/factory";
import { env } from "../lib/env";
import { ApiException } from "../lib/errors";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF 対策（§10.2, §12.3）。更新系メソッドの Origin が WEBAUTHN_ORIGIN と一致しなければ 403。
 * Origin ヘッダが無いリクエスト（curl・サーバー間・テスト）は通す。
 * ブラウザは更新系リクエストで必ず Origin を送るため、CSRF 経路はこれで塞がる。
 */
export const originCheck = createMiddleware(async (c, next) => {
  if (MUTATING_METHODS.has(c.req.method)) {
    const origin = c.req.header("origin");
    if (origin !== undefined && origin !== env().WEBAUTHN_ORIGIN) {
      throw new ApiException("FORBIDDEN", "Origin が一致しません。");
    }
  }
  await next();
});
