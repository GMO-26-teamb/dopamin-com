import type { RegistryError, RegistryErrorCode } from "@dopamin/registry";
import { userMessageForRegistryCode } from "@dopamin/registry";
import type { RegistryId } from "@dopamin/shared";
import type { ContentfulStatusCode } from "hono/utils/http-status";

const REGISTRY_DISPLAY_NAMES: Record<RegistryId, string> = {
  kitaqsign: "Kitaqsign",
  kitaqnic: "Kitaqnic",
  mock: "Mock レジストリ",
};

/** RegistryError → HTTP ステータス（docs/requirements.md §10.3）。 */
export const REGISTRY_ERROR_HTTP: Record<
  RegistryErrorCode,
  ContentfulStatusCode
> = {
  NOT_FOUND: 404,
  CONFLICT: 409,
  OPERATION_NOT_ALLOWED: 409,
  REGISTRY_REJECTED: 422,
  REGISTRY_TIMEOUT: 504,
  REGISTRY_UNAVAILABLE: 502,
  REGISTRY_SPEC_MISMATCH: 502,
};

/**
 * RegistryError → ユーザー向けメッセージ（FR-18）。技術詳細（reason 等）は載せない。
 * エラー応答（error-handler）と部分失敗の一覧（`POST /domains/sync`）で同じ文言を使う。
 *
 * レジストリの result code から原因まで特定できる場合（AuthCode の間違い・重複申請など）は
 * そちらを優先する。表は `packages/registry` の `userMessageForRegistryCode` が正で、
 * ここは「正規化コードだけで決まる既定文言」を持つ（AC-12-2 / §10.3）。
 */
export function registryErrorMessage(err: RegistryError): string {
  const specific = userMessageForRegistryCode(err.registryCode, err.command);
  if (specific !== null) {
    return specific;
  }
  const name = REGISTRY_DISPLAY_NAMES[err.registry];
  switch (err.code) {
    case "REGISTRY_TIMEOUT":
      return `${name} が応答しませんでした。しばらくして再試行してください。`;
    case "REGISTRY_UNAVAILABLE":
      return `${name} に接続できません。しばらくして再試行してください。`;
    case "REGISTRY_SPEC_MISMATCH":
      return `${name} の応答が想定と異なります（レジストリの仕様変更の可能性があります）。`;
    case "REGISTRY_REJECTED":
      return `${name} がリクエストを拒否しました。入力内容を確認してください。`;
    case "NOT_FOUND":
      return "対象のドメインが見つかりません。";
    case "CONFLICT":
      return "対象は既に存在します。";
    case "OPERATION_NOT_ALLOWED":
      return "現在のステータスではこの操作はできません。";
  }
}
