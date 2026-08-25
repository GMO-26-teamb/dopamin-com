import type { AuthUser } from "@dopamin/shared";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { SESSION_COOKIE, setSessionCookie } from "../lib/cookies";
import { getDb } from "../lib/db";
import { ApiException } from "../lib/errors";
import { extendSessionIfNeeded, getSessionWithUser } from "../services/session";

export type AuthVariables = {
  user: AuthUser;
  sessionId: string;
};

/**
 * 認証必須ルート用ミドルウェア（§10.2）。
 * Cookie のセッションを DB で検証し、c.get("user") / c.get("sessionId") を設定する。
 * 未認証は 401（AC-01-3）。
 */
export const requireSession = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    if (!sessionId) {
      throw new ApiException("UNAUTHORIZED", "ログインが必要です。");
    }
    const db = getDb();
    const found = await getSessionWithUser(db, sessionId);
    if (!found) {
      throw new ApiException(
        "UNAUTHORIZED",
        "セッションが無効です。もう一度ログインしてください。",
      );
    }
    // 期限が近ければ DB 側を延長し、Cookie も張り直す
    if (await extendSessionIfNeeded(db, found.session)) {
      setSessionCookie(c, found.session.id);
    }
    c.set("user", { id: found.user.id, displayName: found.user.displayName });
    c.set("sessionId", found.session.id);
    await next();
  },
);
