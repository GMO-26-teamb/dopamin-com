import { describe, expect, it } from "vitest";
import {
  errorCodeForEppResult,
  RegistryError,
  userMessageForRegistryCode,
} from "./errors";

/** EPP result code の正規化と、Bridge 層からの文言表の参照（§10.3 / AC-12-2）。 */

describe("errorCodeForEppResult", () => {
  it.each([
    [2302, "CONFLICT"],
    [2303, "NOT_FOUND"],
    [2304, "OPERATION_NOT_ALLOWED"],
  ])("%i は %s に写す", (code, expected) => {
    expect(errorCodeForEppResult(code)).toBe(expected);
  });

  it("対応の無い 2xxx は REGISTRY_REJECTED", () => {
    for (const code of [2000, 2101, 2201, 2202, 2306, 2400]) {
      expect(errorCodeForEppResult(code)).toBe("REGISTRY_REJECTED");
    }
  });
});

describe("userMessageForRegistryCode の re-export（#47）", () => {
  it("Bridge 層からも同じ表を引ける（実体は @dopamin/shared）", () => {
    expect(userMessageForRegistryCode(2202, "transfer_request")).toBe(
      "AuthCode が正しくありません。",
    );
    expect(userMessageForRegistryCode(2201)).toBeNull();
  });
});

describe("RegistryError.withCommand", () => {
  const base = new RegistryError({
    code: "REGISTRY_REJECTED",
    registry: "mock",
    message: "拒否されました",
    registryCode: 2202,
    reason: "invalid authInfo",
  });

  it("コマンド未設定なら補った複製を返す", () => {
    const withCommand = base.withCommand("transfer_request");
    expect(withCommand).not.toBe(base);
    expect(withCommand.command).toBe("transfer_request");
    // 他のフィールドは保つ（操作ログ・HTTP 変換がこれらを読む）
    expect(withCommand).toMatchObject({
      code: "REGISTRY_REJECTED",
      registry: "mock",
      message: "拒否されました",
      registryCode: 2202,
      reason: "invalid authInfo",
    });
    expect(withCommand.retryable).toBe(false);
  });

  it("既にコマンドが入っていれば同じインスタンスを返す（内側の情報を優先）", () => {
    const inner = base.withCommand("transfer_query");
    expect(inner.withCommand("info")).toBe(inner);
  });
});
