import {
  getDefaultPreparedCorpus,
  scoreDistinctiveness,
  uniquenessLabel,
} from "@dopamin/shared";
import { describe, expect, it } from "vitest";

/**
 * FR-05 の AC のうち、時間を測らないものを実コーパス（ビルド同梱の静的モジュール）で確かめる。
 *
 * - AC-05-1: `google` / `amazon` / `youtube` 等の有名名は `low`
 * - AC-05-3 の「外部 API 呼び出しも DB アクセスも無い」側面
 *
 * 所要時間の AC（1 件 1.5 秒以内）は `latency.perf.test.ts` が担う。
 * 判定の詳細（gold セット・攻撃回帰）は uniqueness.test.ts / default-corpus.test.ts。
 */
describe("FR-05 の AC（実コーパス）", () => {
  it("AC-05-1: 有名サービス名は low になる", () => {
    const corpus = getDefaultPreparedCorpus();
    for (const name of ["google", "amazon", "youtube"]) {
      const result = scoreDistinctiveness(name, corpus);
      expect(uniquenessLabel(result.score), name).toBe("low");
    }
  });

  it("AC-05-3: 算出は同期的に完結する（外部 API も DB も待たない）", () => {
    // 非同期の待ちが入っていれば Promise が返るか、結果が埋まらない。
    const result = scoreDistinctiveness(
      "dopaminchan",
      getDefaultPreparedCorpus(),
    );
    expect(result).not.toBeInstanceOf(Promise);
    expect(typeof result.score).toBe("number");
    expect(result.corpusVersion).toMatch(/^tranco-/);
  });
});
