/**
 * AAGUID → 認証器の表示名（FR-01「名前の初期値は AAGUID から認証器名を推定」、spec §7）。
 *
 * 値は passkeydeveloper/passkey-authenticator-aaguids（コミュニティ管理の公開リスト）から
 * 主要なパスキープロバイダを抜粋したもの。attestationType: "none" でもプラットフォーム認証器は
 * AAGUID を自己申告するので取得できる（伏せる実装は all-zero を返す）。
 * 表に無いものは deviceType で「同期パスキー」/「このデバイス」に落とす。
 */
export const AAGUID_NAMES: Record<string, string> = {
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "iCloud キーチェーン",
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google パスワードマネージャー",
  "adce0002-35bc-c60a-648b-0b25f1f05503": "Chrome（Mac）",
  "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
  "6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "Windows Hello",
  "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
  "d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
  "531126d6-e717-415c-9320-3d9aa6981239": "Dashlane",
  "50726f74-6f6e-5061-7373-50726f746f6e": "Proton Pass",
  "53414d53-554e-4700-0000-000000000000": "Samsung Pass",
  "fdb141b2-5d84-443e-8a35-4698c205a502": "KeePassXC",
  "f3809540-7f14-49c1-a8b3-8f813b225541": "Enpass",
  "b84e4048-15dc-4dd0-8640-f4f60813c8af": "NordPass",
};

/** attestation で AAGUID を伏せる認証器が返す値 */
const UNKNOWN_AAGUID = "00000000-0000-0000-0000-000000000000";

/**
 * 登録時のパスキー初期名。
 * 表にあれば認証器名、無ければ deviceType（SimpleWebAuthn の credentialDeviceType）で
 * 「同期パスキー」（multiDevice）/「このデバイス」（それ以外）。
 */
export function passkeyNameFromAaguid(
  aaguid: string | undefined,
  deviceType: string | undefined,
): string {
  const key = aaguid?.toLowerCase();
  if (key !== undefined && key !== UNKNOWN_AAGUID) {
    const known = AAGUID_NAMES[key];
    if (known !== undefined) {
      return known;
    }
  }
  return deviceType === "multiDevice" ? "同期パスキー" : "このデバイス";
}
