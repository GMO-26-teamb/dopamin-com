import { AI_PROVIDERS } from "@dopamin/shared";
import { describe, expect, it } from "vitest";
import {
  buildDomainCandidatesInstructions,
  DOMAIN_CANDIDATES_INSTRUCTIONS,
} from "./domain-candidates";

/**
 * プロバイダ別の味付け（docs/specs/ai-candidates.md §2.5）。
 *
 * 要点は 2 つ。xai のときだけ作風の指示が足されること、
 * それ以外のプロバイダでは**従来と文字列として完全に同一**であること。
 */

describe("buildDomainCandidatesInstructions（§2.5 プロバイダ別の味付け）", () => {
  it("provider 未指定なら従来のプロンプトと完全に同一", () => {
    expect(buildDomainCandidatesInstructions()).toBe(
      DOMAIN_CANDIDATES_INSTRUCTIONS,
    );
  });

  it.each(["google", "anthropic"] as const)(
    "%s は味付けされず、従来のプロンプトと完全に同一",
    (provider) => {
      expect(buildDomainCandidatesInstructions(provider)).toBe(
        DOMAIN_CANDIDATES_INSTRUCTIONS,
      );
    },
  );

  it("xai だけ作風の指示が足される", () => {
    const instructions = buildDomainCandidatesInstructions("xai");
    expect(instructions).not.toBe(DOMAIN_CANDIDATES_INSTRUCTIONS);
    // 既存の指示は丸ごと残る（味付けは上書きではなく追加）
    expect(instructions.startsWith(DOMAIN_CANDIDATES_INSTRUCTIONS)).toBe(true);
    expect(instructions).toContain("作風");
    expect(instructions).toContain("意外性");
    expect(instructions).toContain("ユーモア");
  });

  it("xai の味付けは §13.2 の制約を上書きしないと明示している", () => {
    const instructions = buildDomainCandidatesInstructions("xai");
    expect(instructions).toContain("上の制約はすべてそのまま守った");
  });

  it("xai の味付けに下品・攻撃的表現の禁止が入っている（デモで見せられるライン）", () => {
    const instructions = buildDomainCandidatesInstructions("xai");
    expect(instructions).toContain("下品");
    expect(instructions).toContain("攻撃的");
    expect(instructions).toContain("人を傷つける");
  });

  it("トーン例は xai の分岐にだけ現れる（他プロバイダに漏れない）", () => {
    const xai = buildDomainCandidatesInstructions("xai");
    expect(xai).toContain("会社の犬");
    // 味付けの本体である DOMAIN_CANDIDATES_INSTRUCTIONS 側には一切入っていない
    expect(DOMAIN_CANDIDATES_INSTRUCTIONS).not.toContain("会社の犬");
    expect(DOMAIN_CANDIDATES_INSTRUCTIONS).not.toContain("作風");
  });

  it("味付けを持たないプロバイダを足しても既定は無味のまま（将来の追加で壊れない）", () => {
    const plain = AI_PROVIDERS.filter((p) => p !== "xai");
    for (const provider of plain) {
      expect(buildDomainCandidatesInstructions(provider)).toBe(
        DOMAIN_CANDIDATES_INSTRUCTIONS,
      );
    }
  });

  it("件数と reason 上限の制約は味付け後も残る（契約は不変）", () => {
    const instructions = buildDomainCandidatesInstructions("xai");
    expect(instructions).toContain("候補はちょうど 6 件");
    expect(instructions).toContain("reason は日本語で 40 字以内");
  });
});
