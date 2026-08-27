import {
  getDefaultPreparedCorpus,
  scoreDistinctiveness,
  uniquenessLabel,
} from "@dopamin/shared";
import { describe, expect, it } from "vitest";

/**
 * FR-05 の AC を実コーパス（ビルド同梱の静的モジュール）で確かめる。
 *
 * - AC-05-1: `google` / `amazon` / `youtube` 等の有名名は `low`
 * - AC-05-3: 1 件あたり 1.5 秒以内（外部 API 呼び出しも DB アクセスも無い）
 *
 * 判定の詳細（gold セット・攻撃回帰）は uniqueness.test.ts / default-corpus.test.ts が担う。
 * ここは「requirements の AC がそのまま守られているか」だけを見る。
 */

/** AC-05-3 の上限（§14.2。実測 p95 は約 0.22 秒）。 */
const AC_05_3_BUDGET_MS = 1_500;

describe("FR-05 の AC（実コーパス）", () => {
  it("AC-05-1: 有名サービス名は low になる", () => {
    const corpus = getDefaultPreparedCorpus();
    for (const name of ["google", "amazon", "youtube"]) {
      const result = scoreDistinctiveness(name, corpus);
      expect(uniquenessLabel(result.score), name).toBe("low");
    }
  });

  it("AC-05-3: 1 件あたり 1.5 秒以内で算出できる", () => {
    // 初回はコーパスの準備（正規化ビューの構築）を含むので、それも予算内に収まることを見る
    const cold = Date.now();
    scoreDistinctiveness("dopaminchan", getDefaultPreparedCorpus());
    expect(Date.now() - cold).toBeLessThan(AC_05_3_BUDGET_MS);

    // 準備済みコーパスでの 1 件あたり（画面が並べる候補 6 件ぶんも予算内に収まる想定）
    const corpus = getDefaultPreparedCorpus();
    const warm = Date.now();
    scoreDistinctiveness("takutakuland", corpus);
    expect(Date.now() - warm).toBeLessThan(AC_05_3_BUDGET_MS);
  });
});
