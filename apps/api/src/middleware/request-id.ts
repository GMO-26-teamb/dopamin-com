import { createMiddleware } from "hono/factory";

export type RequestIdVariables = {
  requestId: string;
};

// クライアントから来た x-request-id はログ汚染を避けるため英数字・-・_ の 64 文字までに限定する
const INCOMING_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * リクエスト ID（§10.2 項目 1）。
 * x-request-id ヘッダを引き継ぐか採番し、c.get("requestId") とレスポンスヘッダに載せる。
 * errorHandler はこれを統一エラー形式（§10.3）の requestId に入れる。
 */
export const requestId = createMiddleware<{ Variables: RequestIdVariables }>(
  async (c, next) => {
    const incoming = c.req.header("x-request-id");
    const id =
      incoming && INCOMING_ID.test(incoming)
        ? incoming
        : `req_${crypto.randomUUID()}`;
    c.set("requestId", id);
    c.header("x-request-id", id);
    await next();
  },
);
