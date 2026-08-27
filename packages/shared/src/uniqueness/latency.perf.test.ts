import {
  buildDefaultCorpusEntries,
  DEFAULT_CORPUS_VERSION,
  getDefaultPreparedCorpus,
  prepareCorpus,
  scoreDistinctiveness,
} from "@dopamin/shared";
import { describe, expect, it } from "vitest";

/**
 * FR-05 の AC-05-3（1 件あたり 1.5 秒以内）を実コーパスで確かめる性能テスト。
 *
 * このファイルは既定の `pnpm test` からは外してある（`vitest.config.ts` の exclude）。
 * 単独実行は `pnpm --filter @dopamin/shared test:perf`。
 *
 * なぜ分けるか（#181 / #178）:
 * CI の `check` ジョブは `turbo run typecheck test build` で api / web / shared のテストと
 * next build を同時に走らせる。GitHub Actions の runner は 2 コアなので、この状態で計測すると
 * 1 件あたりの実測がローカルの十数倍（実測 0.1 秒 → 2 秒）に膨らみ、AC を満たしていても落ちる。
 * 予算を甘くして誤魔化すと退行を検出できなくなるので、代わりに計測を他の負荷と
 * 同居させないようにした。CI では `check` ジョブの最後に単独ステップとして走らせる。
 *
 * それでも共有ランナーには多少のゆらぎがあるため、ウォームアップぶんを捨てて
 * 複数回計測した中央値で判定し、取れる環境では壁時計ではなく CPU 時間を使う。
 */

/** AC-05-3 の上限（§14.2。実測 p95 は約 0.22 秒）。 */
const AC_05_3_BUDGET_MS = 1_500;

/**
 * コーパス準備（9k 件弱の正規化ビュー事前計算）の上限。
 * AC-05-3 が定めるのは「算出 1 件あたり」で準備は含まれないため、AC ではなく
 * 「破滅的な退行が無いか」だけを見る煙感知器として緩い別予算を置く。
 */
const CORPUS_PREPARE_BUDGET_MS = 5_000;

/** 1 件でもストールしたサンプルに引きずられないよう複数回測る。奇数。 */
const SAMPLES = 9;
/** 捨てる先頭の計測回数（V8 の JIT ウォームアップぶん）。 */
const WARMUP = 2;

/**
 * 計測が予算を超えても vitest の既定タイムアウト（5 秒）で先に落ちないようにする。
 * ここで落ちるべきは「遅い」ことであって「タイムアウトした」ことではない。
 */
const TEST_TIMEOUT_MS = 120_000;

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

describe("FR-05 の性能（実コーパス）", () => {
  it("AC-05-3: 1 件あたり 1.5 秒以内で算出できる", {
    timeout: TEST_TIMEOUT_MS,
  }, () => {
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

  it("コーパスの準備が破滅的に遅くなっていない", {
    timeout: TEST_TIMEOUT_MS,
  }, () => {
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
