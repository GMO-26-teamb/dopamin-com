import { defineConfig } from "vitest/config";

/**
 * 既定のテスト実行。性能計測（`*.perf.test.ts`）はここから外す。
 *
 * CI の `check` ジョブは `turbo run typecheck test build` で全パッケージのテストと
 * next build を同時に走らせる。GitHub Actions の runner は 2 コアなので、この状態で
 * 壁時計を測ると 1 件あたりの実測がローカルの十数倍（0.1 秒 → 2 秒）に膨らみ、
 * AC を満たしていても落ちる（#181 / #178）。計測値を甘くするのではなく、
 * 計測そのものを他の負荷と同居させないようにする。
 *
 * 単独実行は `pnpm --filter @dopamin/shared test:perf`（設定は vitest.perf.config.ts）。
 */
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.perf.test.ts"],
  },
});
