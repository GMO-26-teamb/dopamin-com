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

/**
 * 初回（コーパス準備込み）の上限。AC-05-3 が定めるのは「算出 1 件あたり」で、
 * 正規化ビューの構築（初回のみ）は含まれない。共有 CI ランナーの負荷ゆらぎで
 * 準備込みが 1.5 秒を断続的に超えて CI が落ちるため（#178。実測 1.6〜1.8 秒）、
 * 準備込みだけ別予算にする。AC 本体の検証は下の warm 計測が担う。
 */
const COLD_BUDGET_MS = 3_000;

describe("FR-05 の AC（実コーパス）", () => {
  it("AC-05-1: 有名サービス名は low になる", () => {
    const corpus = getDefaultPreparedCorpus();
    for (const name of ["google", "amazon", "youtube"]) {
      const result = scoreDistinctiveness(name, corpus);
      expect(uniquenessLabel(result.score), name).toBe("low");
    }
  });

  it("AC-05-3: 1 件あたり 1.5 秒以内で算出できる", () => {
    // 初回はコーパスの準備（正規化ビューの構築）を含むので、緩めの別予算で見る（#178）
    const cold = Date.now();
    scoreDistinctiveness("dopaminchan", getDefaultPreparedCorpus());
    expect(Date.now() - cold).toBeLessThan(COLD_BUDGET_MS);

    // 準備済みコーパスでの 1 件あたり（画面が並べる候補 6 件ぶんも予算内に収まる想定）
    const corpus = getDefaultPreparedCorpus();
    const warm = Date.now();
    scoreDistinctiveness("takutakuland", corpus);
    expect(Date.now() - warm).toBeLessThan(AC_05_3_BUDGET_MS);
  });
});
