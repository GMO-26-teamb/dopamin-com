import { describe, expect, it } from "vitest";
import { userMessageForRegistryCode } from "./registry-codes";

/**
 * レジストリ result code → ユーザー向けの理由文（docs/requirements.md §10.3 / AC-12-2）。
 * API のエラー応答（apps/api）と画面の Error Card（apps/web）が同じ表を読む。
 */

describe("userMessageForRegistryCode（#47）", () => {
  it("AC-12-2: 2202 は AuthCode の間違いとして伝える", () => {
    expect(userMessageForRegistryCode("2202", "transfer_request")).toBe(
      "AuthCode が正しくありません。",
    );
  });

  it("移管以外のコマンドの 2202 は「認証情報」と呼ぶ", () => {
    expect(userMessageForRegistryCode("2202", "update")).toBe(
      "認証情報が正しくありません。",
    );
  });

  it("2304 はコマンドで読み方を変える", () => {
    expect(userMessageForRegistryCode("2304", "transfer_approve")).toContain(
      "移管できません",
    );
    expect(userMessageForRegistryCode("2304", "renew")).toBe(
      "現在のステータスではこの操作を実行できません。",
    );
  });

  it("command が無ければ移管文脈に倒す（画面側は command を持たない）", () => {
    expect(userMessageForRegistryCode("2202")).toBe(
      "AuthCode が正しくありません。",
    );
    expect(userMessageForRegistryCode("2304")).toContain("移管できません");
  });

  it("移管の状態に関する code を伝える", () => {
    expect(userMessageForRegistryCode("2300")).toBe("すでに移管申請中です。");
    expect(userMessageForRegistryCode("2301")).toBe("すでに移管申請中です。");
    expect(userMessageForRegistryCode("2106")).toBe(
      "このドメインは移管の対象外です。",
    );
    expect(userMessageForRegistryCode("2303")).toBe(
      "このドメインは登録されていません。",
    );
  });

  it("number でも string でも同じ結果（API は number、画面は string で持つ）", () => {
    for (const code of [2106, 2202, 2300, 2301, 2303, 2304]) {
      expect(userMessageForRegistryCode(code)).toBe(
        userMessageForRegistryCode(String(code)),
      );
    }
  });

  it("表に無いコード・コード無しは null（呼び出し側の既定文言に任せる）", () => {
    expect(userMessageForRegistryCode("2201")).toBeNull();
    expect(userMessageForRegistryCode(2302)).toBeNull();
    expect(userMessageForRegistryCode(undefined)).toBeNull();
    expect(userMessageForRegistryCode(null)).toBeNull();
  });

  it("FR-18: レジストリの生応答を混ぜない（固定文言だけを返す）", () => {
    for (const code of [2106, 2202, 2300, 2301, 2303, 2304]) {
      const message = userMessageForRegistryCode(code);
      expect(message).not.toBeNull();
      // result code や英語の生メッセージが漏れていないこと
      expect(message).not.toMatch(/\d{4}|result|Object/);
    }
  });
});
