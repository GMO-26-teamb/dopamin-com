/**
 * 操作ログの request / response に含まれる機密値のマスク（docs/requirements.md FR-15 AC-15-2）。
 *
 * キー名（大文字小文字・区切り文字を無視）が機密語彙を含む値を `"***"` に置換する。
 * 値の型は問わない（文字列・オブジェクト・配列いずれも丸ごと `"***"` になる）。
 * DB（operation_logs）へ保存する側（RegistryClient ラッパー）が保存直前に適用する。
 */

/**
 * マスク対象の語彙（小文字・英数字のみに正規化したキー名に「含まれる」かで判定する）。
 * 完全一致ではなく部分一致にするのは、`x-api-key` / `accessToken` / `clientSecret` /
 * `gatePassword` のような接頭辞・接尾辞付きの形を取りこぼさないため
 * （AC-15-2 の唯一の機構なので、過剰マスクより取りこぼしを避ける）。
 */
const SENSITIVE_FRAGMENTS: readonly string[] = [
  "authinfo", // EPP AuthCode（authInfo / auth_info）
  "authcode",
  "apikey", // X-Api-Key（api_key / apiKey / x-api-key）
  "password", // ゲート認証（gatePassword / password）
  "passwd",
  "authorization", // Basic 認証ヘッダ
  "secret", // clientSecret / apiSecret
  "token", // accessToken / refreshToken
];

/** 短すぎて部分一致にできない語彙は完全一致で持つ（EPP authInfo の `pw` 要素）。 */
const SENSITIVE_EXACT: ReadonlySet<string> = new Set(["pw"]);

/** マスク後の値（AC-15-2 で固定）。 */
export const MASKED_VALUE = "***";

/** ネスト暴走への防御。JSON 由来の入力では通常届かない深さ。 */
const MAX_DEPTH = 32;

function isSensitiveKey(key: string): boolean {
  // authInfo / auth_info / AUTH-INFO / x-api-key をすべて英数字小文字に正規化して比較する
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    SENSITIVE_EXACT.has(normalized) ||
    SENSITIVE_FRAGMENTS.some((fragment) => normalized.includes(fragment))
  );
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
