/**
 * 操作ログの request / response に含まれる機密値のマスク（docs/requirements.md FR-15 AC-15-2）。
 *
 * キー名（大文字小文字・区切り文字を無視）が機密語彙に一致した値を `"***"` に置換する。
 * 値の型は問わない（文字列・オブジェクト・配列いずれも丸ごと `"***"` になる）。
 * DB（operation_logs）へ保存する側（RegistryClient ラッパー）が保存直前に適用する。
 */

/** マスク対象のキー（小文字・英数字のみに正規化して比較する）。 */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  "authinfo", // EPP AuthCode（authInfo / auth_info）
  "authcode",
  "apikey", // X-Api-Key（api_key / apiKey）
  "password", // ゲート認証（gatePassword もここに正規化される前提ではないため個別に持つ）
  "gatepassword",
  "authorization", // Basic 認証ヘッダ
  "secret",
  "token",
]);

/** マスク後の値（AC-15-2 で固定）。 */
export const MASKED_VALUE = "***";

/** ネスト暴走への防御。JSON 由来の入力では通常届かない深さ。 */
const MAX_DEPTH = 32;

function isSensitiveKey(key: string): boolean {
  // authInfo / auth_info / AUTH-INFO をすべて "authinfo" に正規化して比較する
  return SENSITIVE_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

function maskInner(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) {
    return MASKED_VALUE;
  }
  if (Array.isArray(value)) {
    return value.map((item) => maskInner(item, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    const masked: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      masked[key] = isSensitiveKey(key)
        ? MASKED_VALUE
        : maskInner(entry, depth + 1);
    }
    return masked;
  }
  return value;
}

/**
 * 機密キーの値を再帰的に `"***"` へ置換した複製を返す（入力は変更しない）。
 * プレーンなオブジェクト・配列・プリミティブ（JSON 相当）を想定する。
 */
export function maskSensitiveValues(value: unknown): unknown {
  return maskInner(value, 0);
}
