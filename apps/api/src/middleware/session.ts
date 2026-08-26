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

/** セッション ID からユーザーを引く処理。既定は DB 参照で、テストのみ差し替える。 */
export type SessionResolver = (sessionId: string) => Promise<{
  user: AuthUser;
  sessionId: string;
  /** Cookie を張り直したか（有効期限の延長が起きたか）。 */
  extended: boolean;
} | null>;

const dbSessionResolver: SessionResolver = async (sessionId) => {
  const db = getDb();
  const found = await getSessionWithUser(db, sessionId);
  if (!found) {
    return null;
  }
  return {
    user: { id: found.user.id, displayName: found.user.displayName },
    sessionId: found.session.id,
    // 期限が近ければ DB 側を延長する（§10.2）
    extended: await extendSessionIfNeeded(db, found.session),
  };
};

let resolverOverride: SessionResolver | null = null;

/**
 * テスト専用: セッション解決だけを差し替える（Cookie 検証・401・Cookie 張り直しは本番と同じ経路を通す）。
 * null で既定の DB 参照に戻す。本番コードからは呼ばない。
 */
export function setSessionResolverForTesting(
  resolver: SessionResolver | null,
): void {
  resolverOverride = resolver;
}

/**
 * 認証必須ルート用ミドルウェア（§10.2）。
 * Cookie のセッションを検証し、c.get("user") / c.get("sessionId") を設定する。
 * 未認証は 401（AC-01-3）。
 */
export const requireSession = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    if (!sessionId) {
      throw new ApiException("UNAUTHORIZED", "ログインが必要です。");
    }
    const resolved = await (resolverOverride ?? dbSessionResolver)(sessionId);
    if (!resolved) {
      throw new ApiException(
        "UNAUTHORIZED",
        "セッションが無効です。もう一度ログインしてください。",
      );
    }
    if (resolved.extended) {
      setSessionCookie(c, resolved.sessionId);
    }
    c.set("user", resolved.user);
    c.set("sessionId", resolved.sessionId);
    await next();
  },
);
