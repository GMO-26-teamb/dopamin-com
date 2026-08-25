/**
 * `?next=` の行き先を安全なパスに丸める（ui-screens §1、AC-01-3）。
 *
 * 未認証アクセスは `/login?next=<path>`、API 401 は `/login?reason=expired&next=<path>` で
 * 戻り先を運ぶ。値は URL 由来＝外部入力なので、オープンリダイレクトにならないよう
 * 「同一オリジンの絶対パス」だけを通す。
 */

/** 既定の行き先（S-10 / S-11）。 */
export const DEFAULT_NEXT_PATH = "/dashboard";

/**
 * `raw` が同一オリジンのパスなら正規化して返し、そうでなければ `null`。
 *
 * 弾くもの: 未指定 / 空 / `/` で始まらない（`https://evil.example`, `javascript:…`）/
 * `//evil.example`（プロトコル相対）/ `/\evil.example`（一部ブラウザが `//` と解釈する）/
 * 認証画面そのもの（`/login` `/signup` に戻すとループする）。
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw === "") {
    return null;
  }
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return null;
  }
  const path = raw.split(/[?#]/)[0] ?? "";
  if (path === "/login" || path === "/signup" || path === "/") {
    return null;
  }
  return raw;
}

/** ログイン / サインアップ成功後の行き先。 */
export function nextPathOrDefault(raw: string | null | undefined): string {
  return safeNextPath(raw) ?? DEFAULT_NEXT_PATH;
}

/** `?next=` を引き継いだまま別の認証画面へ渡すための href を作る。 */
export function withNext(pathname: string, next: string | null): string {
  const safe = safeNextPath(next);
  return safe === null
    ? pathname
    : `${pathname}?next=${encodeURIComponent(safe)}`;
}
