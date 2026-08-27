import { describe, expect, it } from "vitest";
import { deleteCopy } from "./delete-dialog";

/**
 * D-03 廃止ダイアログの文言（FR-10 / ui-screens D-03）。
 *
 * AGP 内でも delete の遷移先はレジストリ次第（mock / kitaqsign は
 * `pendingDelete + redemptionPeriod` に入る）。「即時に削除される」と断定すると
 * 実結果と食い違うので、予告は両分岐に矛盾しない書き方であることを固定する（#173）。
 */
describe("deleteCopy（D-03）", () => {
  it("AGP 内は無課金の取消扱いとして見出し・ボタンを切り替える", () => {
    const copy = deleteCopy("takutaku.com", true);

    expect(copy.title).toBe("takutaku.com を取り消しますか？");
    expect(copy.primaryLabel).toBe("取り消す");
    expect(copy.subtitle).toContain("無課金で取消扱い");
  });

  it("AGP 内の予告は即時削除を断定せず、RGP に入る場合にも触れる", () => {
    const { note } = deleteCopy("takutaku.com", true);

    expect(note).toContain("復旧猶予（RGP）");
    // 「即時に削除され、元に戻せません」と言い切らない（実際は RGP に入る）
    expect(note).not.toMatch(/即時に削除され、元に戻せません/);
  });

  it("AGP 外は 30 日の復旧猶予（RGP）を予告する", () => {
    const copy = deleteCopy("takutaku.com", false);

    expect(copy.title).toBe("takutaku.com を廃止しますか？");
    expect(copy.primaryLabel).toBe("廃止する");
    expect(copy.subtitle).toContain("30 日間の復旧猶予（RGP）");
    expect(copy.note).toContain("復旧");
  });
});
