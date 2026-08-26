/**
 * 「このブラウザタブでログイン済みか」の目印（FR-01 / ui-screens §1）。
 *
 * 本番（`NEXT_PUBLIC_API_MODE=http`）のログイン状態は API が発行する `dopamin_session`
 * Cookie が持っていて、フロントは `GET /auth/me`（`useMe({ probe: true })`）で確かめる。
 *
 * 一方モックモードにはセッションが無く、`AuthService.login()` も `settings.me()` も常に成功する。
 * それをそのまま「ログイン済み」と解釈すると S-00 / S-01 / S-02 が常に `/dashboard` へ飛んで
 * しまい、モックで全画面を確認するという設計（fe-ui 設計 §1）が成り立たない。
 * そこで「モックでログインに成功した」ことだけを `sessionStorage` に覚えて代用する。
 * タブを閉じれば消えるので、レビューはいつでも未ログインから始められる。
 */

const SESSION_KEY = "dopamin-auth-session";

/** SSR とプライベートモード（sessionStorage が例外を投げる）の両方を吸収する。 */
function storage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function startAuthSession(): void {
  storage()?.setItem(SESSION_KEY, "1");
}

export function endAuthSession(): void {
  storage()?.removeItem(SESSION_KEY);
}

export function hasAuthSession(): boolean {
  return storage()?.getItem(SESSION_KEY) === "1";
}
