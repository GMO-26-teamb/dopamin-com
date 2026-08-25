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
 * 検証用の基準オリジン。実在しない TLD（RFC 6761 の `.invalid`）を使うので、
 * 解決結果のオリジンがこれと違えば「外に出た」と判定できる。
 */
const PLACEHOLDER_ORIGIN = "https://placeholder.invalid";

/**
 * C0 制御文字（`\u0000`〜`\u001f`）と DEL（`\u007f`）を含むか。
 *
 * URL パーサはこれらを読み飛ばすため、`/\t/evil.example` が
 * `https://evil.example/` に化ける（`//` の前方一致検査をすり抜ける）。
 */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * `raw` が同一オリジンのパスなら正規化して返し、そうでなければ `null`。
 *
 * 弾くもの: 未指定 / 空 / 制御文字を含む（`/\t/evil.example` など）/ `/` で始まらない
 * （`https://evil.example`, `javascript:…`）/ `//evil.example`（プロトコル相対）/
 * `/\evil.example`（一部ブラウザが `//` と解釈する）/ それらの %-エンコード版 /
 * パースすると別オリジンになるもの / 認証画面そのもの（`/login` `/signup` に戻すとループする）。
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw === "") {
    return null;
  }
  if (hasControlChar(raw)) {
    return null;
  }
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return null;
  }

  // 前方一致だけでは足りない（`%2F%2Fevil` のような多重エンコードが残る）ので、
  // 実際にパースして「オリジンが動かないこと」を確かめる。
  let url: URL;
  try {
    url = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) {
    return null;
  }

  // デコードすると `//` / `/\` / 制御文字になるパス（`/%5Cevil` など）も同じ手口。
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (
    hasControlChar(decodedPath) ||
    decodedPath.startsWith("//") ||
    decodedPath.startsWith("/\\")
  ) {
    return null;
  }

  if (
    url.pathname === "/login" ||
    url.pathname === "/signup" ||
    url.pathname === "/"
  ) {
    return null;
  }
  return `${url.pathname}${url.search}${url.hash}`;
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

/** 画面に出す用の「戻り先」。クエリ・ハッシュは落としてパスだけ見せる。 */
export function nextPathLabel(next: string | null | undefined): string | null {
  const safe = safeNextPath(next);
  if (safe === null) {
    return null;
  }
  return safe.split(/[?#]/)[0] ?? null;
}
