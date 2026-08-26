import type { AuthUser } from "@dopamin/shared";

/** Hono の環境型。requestId ミドルウェアが設定する変数を全ルートで共有する。 */
export type AppEnv = {
  Variables: {
    requestId: string;
  };
};

/**
 * 認証必須ルートの環境型（§10.2 の session ミドルウェア適用後）。
 * `requireSession` を通ったルートでは `c.get("user")` / `c.get("sessionId")` が必ず入る。
 */
export type AuthedEnv = {
  Variables: AppEnv["Variables"] & {
    user: AuthUser;
    sessionId: string;
  };
};
