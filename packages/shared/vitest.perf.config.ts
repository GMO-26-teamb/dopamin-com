import { defineConfig } from "vitest/config";

/**
 * 性能計測（`*.perf.test.ts`）だけを単独で走らせる設定。
 * 他パッケージのテストや next build と同時に走らせない前提で、
 * requirements の AC（FR-05 の AC-05-3 = 1 件 1.5 秒以内）をそのままの値で検証する。
 */
export default defineConfig({
  test: {
    include: ["**/*.perf.test.ts"],
    // 1 ファイルしか無いが、将来増えても互いに干渉しないよう直列に走らせる
    fileParallelism: false,
  },
});
