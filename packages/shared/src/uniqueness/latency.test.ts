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
 * 計測方法について（#181 / #178）:
 * GitHub Actions の共有ランナーは 2 コアで、vitest が複数のテストファイルを並列に走らせる。
 * このため壁時計の単発計測は CPU steal と GC で数倍に跳ね、AC を満たしていても CI が落ちる
 * （実測: ローカル約 0.1 秒 / CI で 1.7 秒。同じ run の中で cold 計測より warm 計測の方が
 * 遅いという逆転も観測された = 実処理コストではなくスケジューリング由来）。ここでは
 *   1. ウォームアップぶんを捨て、
 *   2. 複数回計測して中央値を取り、
 *   3. 取れる環境では壁時計ではなくプロセスの CPU 時間で判定する
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

/** 計測回数。単発だと共有 CI ランナーの 1 回のストールで落ちるので中央値で判定する。奇数。 */
const SAMPLES = 9;
/** 捨てる先頭の計測回数（V8 の JIT ウォームアップぶん）。 */
const WARMUP = 2;

/**
 * `process.cpuUsage`（Node）への参照。
 * `packages/shared` はブラウザからも import されるので `lib` は ES2023 だけにしてあり、
 * node / DOM の型を足さない。ここでだけ構造的に取り出して、無い環境では壁時計に落ちる。
 */
const nodeCpuUsage = (
  globalThis as {
    process?: { cpuUsage?: () => { user: number; system: number } };
  }
).process?.cpuUsage;

/** 計測時刻をミリ秒で返す。CPU 時間が取れるならそれを、無ければ壁時計を使う。 */
function elapsedSourceMs(): number {
  if (nodeCpuUsage !== undefined) {
    const { user, system } = nodeCpuUsage();
    return (user + system) / 1000;
  }
  return Date.now();
}

/** どちらの時計で測ったかを失敗メッセージに出すためのラベル。 */
const CLOCK = nodeCpuUsage !== undefined ? "cpu" : "wall";

/** 計測ごとに違う語を使う（同じ入力を繰り返して有利な経路だけを測らないため）。 */
function probeName(i: number): string {
  return `dopaminprobe${i}zx`;
}

/** 昇順ソートした中央値（SAMPLES は奇数なので中央の 1 件）。 */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid];
  if (hi === undefined) {
    throw new Error("median: サンプルが空です");
  }
  if (sorted.length % 2 !== 0) {
    return hi;
  }
  return ((sorted[mid - 1] ?? hi) + hi) / 2;
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
    const samples: number[] = [];
    for (let i = 0; i < WARMUP + SAMPLES; i++) {
      const started = elapsedSourceMs();
      scoreDistinctiveness(probeName(i), corpus);
      const elapsed = elapsedSourceMs() - started;
      if (i >= WARMUP) {
        samples.push(elapsed);
      }
    }
    const detail = `${CLOCK} median=${Math.round(median(samples))}ms samples=[${samples.map(Math.round).join(",")}]`;
    expect(median(samples), detail).toBeLessThan(AC_05_3_BUDGET_MS);
  });

  it("コーパスの準備が破滅的に遅くなっていない", () => {
    // getDefaultPreparedCorpus() はモジュール単位でメモ化されるので、
    // 準備そのものを測るには prepareCorpus を直接呼ぶ。
    const entries = buildDefaultCorpusEntries();
    const started = elapsedSourceMs();
    prepareCorpus(entries, { version: DEFAULT_CORPUS_VERSION });
    const elapsed = elapsedSourceMs() - started;
    expect(elapsed, `${CLOCK} elapsed=${Math.round(elapsed)}ms`).toBeLessThan(
      CORPUS_PREPARE_BUDGET_MS,
    );
  });
});
