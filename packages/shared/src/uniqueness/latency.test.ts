import {
  buildDefaultCorpusEntries,
  DEFAULT_CORPUS_VERSION,
  getDefaultPreparedCorpus,
  prepareCorpus,
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
 *
 * 計測方法について（#178）:
 * GitHub Actions の共有ランナーは 2 コアで、vitest が複数のテストファイルを並列に走らせる。
 * このため壁時計の単発計測は CPU steal と GC で数倍に跳ね、AC を満たしていても CI が落ちる
 * （実測: ローカル約 0.1 秒 / CI で 1.7 秒）。ここでは
 *   1. ウォームアップぶんを捨て、
 *   2. 複数回計測して中央値を取り、
 *   3. 壁時計ではなくプロセスの CPU 時間で判定する
 * ことで、スケジューリング由来のゆらぎを外しつつアルゴリズムの退行は検出できるようにする。
 * FR-05 は外部 I/O を持たない純 CPU 処理なので、本番（Vercel Functions）では
 * 壁時計 ≒ CPU 時間になり、CPU 時間で見ても AC の意味は保たれる。
 */

/** AC-05-3 の上限（§14.2。実測 p95 は約 0.22 秒）。 */
const AC_05_3_BUDGET_MS = 1_500;

/**
 * コーパス準備（9k 件弱の正規化ビュー事前計算）の上限。
 * AC-05-3 が定めるのは「算出 1 件あたり」で準備は含まれないため、AC ではなく
 * 「破滅的な退行が無いか」だけを見る煙感知器として緩い別予算を置く。
 */
const CORPUS_PREPARE_BUDGET_MS = 5_000;

/** 計測回数。単発だと共有 CI ランナーの 1 回のストールで落ちるので中央値で判定する。 */
const SAMPLES = 9;
/** 捨てる先頭の計測回数（V8 の JIT ウォームアップぶん）。 */
const WARMUP = 2;

/** 計測ごとに違う語を使う（同じ入力を繰り返して有利な経路だけを測らないため）。 */
function probeName(i: number): string {
  return `dopaminprobe${i}zx`;
}

/** このプロセスが消費した CPU 時間（user + system）をミリ秒で返す。 */
function cpuMs(): number {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
}

/** 昇順ソートした中央値。 */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

describe("FR-05 の AC（実コーパス）", () => {
  it("AC-05-1: 有名サービス名は low になる", () => {
    const corpus = getDefaultPreparedCorpus();
    for (const name of ["google", "amazon", "youtube"]) {
      const result = scoreDistinctiveness(name, corpus);
      expect(uniquenessLabel(result.score), name).toBe("low");
    }
  });

  it("AC-05-3: 1 件あたり 1.5 秒以内で算出できる", () => {
    // 準備済みコーパスでの 1 件あたり（画面が並べる候補 6 件ぶんも予算内に収まる想定）
    const corpus = getDefaultPreparedCorpus();
    const cpuSamples: number[] = [];
    const wallSamples: number[] = [];
    for (let i = 0; i < WARMUP + SAMPLES; i++) {
      const cpuStart = cpuMs();
      const wallStart = performance.now();
      scoreDistinctiveness(probeName(i), corpus);
      const cpuElapsed = cpuMs() - cpuStart;
      const wallElapsed = performance.now() - wallStart;
      if (i >= WARMUP) {
        cpuSamples.push(cpuElapsed);
        wallSamples.push(wallElapsed);
      }
    }
    const detail = `cpu median=${Math.round(median(cpuSamples))}ms wall median=${Math.round(median(wallSamples))}ms cpu samples=[${cpuSamples.map(Math.round).join(",")}]`;
    expect(median(cpuSamples), detail).toBeLessThan(AC_05_3_BUDGET_MS);
  });

  it("コーパスの準備が破滅的に遅くなっていない", () => {
    // getDefaultPreparedCorpus() はモジュール単位でメモ化されるので、
    // 準備そのものを測るには prepareCorpus を直接呼ぶ。
    const entries = buildDefaultCorpusEntries();
    const started = cpuMs();
    prepareCorpus(entries, { version: DEFAULT_CORPUS_VERSION });
    expect(cpuMs() - started).toBeLessThan(CORPUS_PREPARE_BUDGET_MS);
  });
});
