// ============================================================
// パッケージ公開入口 (@dopamin/shared) 経由で FR-05 スコアリング API に
// 到達できることの検証。個別関数の詳細な挙動は uniqueness.test.ts が担う。
// 入口の再エクスポート (src/index.ts → src/uniqueness.ts → src/uniqueness/index.ts)
// が切れた場合、このテストがコンパイル段階で失敗する。
// ============================================================

import {
  ALGORITHM_VERSION,
  type CorpusEntry,
  getDefaultWordChecker,
  prepareCorpus,
  rarityTier,
  scoreDistinctiveness,
  uniquenessBand,
  uniquenessLabel,
  uniquenessResultSchema,
} from "@dopamin/shared";
import { describe, expect, it } from "vitest";

const CORPUS: CorpusEntry[] = [
  { name: "google", tier: "tranco", rank: 1 },
  { name: "amazon", tier: "tranco", rank: 7 },
  { name: "notion", tier: "tech" },
];

describe("公開入口 (@dopamin/shared) 経由の FR-05 API", () => {
  const prepared = prepareCorpus(CORPUS, { version: "public-api-test" });

  it("scoreDistinctiveness が入口から呼べて、結果がスキーマに適合する", () => {
    const r = scoreDistinctiveness("googel", prepared);
    expect(uniquenessResultSchema.safeParse(r).success).toBe(true);
    expect(r.algorithmVersion).toBe(ALGORITHM_VERSION);
    expect(r.corpusVersion).toBe("public-api-test");
    // 有名名の距離1 typo は低スコア帯 (詳細な帯の検証は uniqueness.test.ts)
    expect(uniquenessBand(r.score)).toBe("low");
  });

  it("独自性の高い造語は高スコア帯になる", () => {
    const r = scoreDistinctiveness("zufemira", prepared);
    expect(uniquenessBand(r.score)).toBe("high");
  });

  it("既存のラベル・レアリティ API (uniquenessLabel / rarityTier) は維持される", () => {
    expect(uniquenessLabel(85)).toBe("high");
    expect(rarityTier(85)).toBe("SSR");
    expect(uniquenessLabel(55)).toBe("medium");
    expect(rarityTier(55)).toBe("R");
    expect(uniquenessLabel(10)).toBe("low");
    expect(rarityTier(10)).toBe("N");
  });

  it("デフォルト一般語判定器 (同梱75,150語) が入口から取得できる", () => {
    const checker = getDefaultWordChecker();
    expect(checker.isCommonWord("notebook")).toBe(true);
    expect(checker.isCommonWord("zufemira")).toBe(false);
    // メモ化: 同一インスタンスが返る (採点ごとの巨大Set再構築をしない)
    expect(getDefaultWordChecker()).toBe(checker);
  });
});
