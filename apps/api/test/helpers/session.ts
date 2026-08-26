import type { AuthUser } from "@dopamin/shared";
import { setSessionResolverForTesting } from "../../src/middleware/session";

/** テスト用のログインユーザー。 */
export const TEST_USER: AuthUser = {
  id: "00000000-0000-4000-8000-000000000001",
  displayName: "テストユーザー",
};

/** 所有権チェック（NFR-04）の検証に使う別ユーザー。 */
export const OTHER_USER: AuthUser = {
  id: "00000000-0000-4000-8000-000000000002",
  displayName: "別のユーザー",
};

const VALID_SESSION_ID = "test-session";

/** 認証済みリクエスト用の Cookie ヘッダ。 */
export const SESSION_COOKIE_HEADER = `dopamin_session=${VALID_SESSION_ID}`;

/**
 * セッション解決だけを差し替える（Cookie 検証・401 は本番と同じ経路を通る）。
 * DB を立てずに認証必須ルートの中身を検証するための seam。
 */
export function installTestSession(user: AuthUser = TEST_USER): void {
  setSessionResolverForTesting((sessionId) =>
    Promise.resolve(
      sessionId === VALID_SESSION_ID
        ? { user, sessionId, extended: false }
        : null,
    ),
  );
}

export function clearTestSession(): void {
  setSessionResolverForTesting(null);
}
