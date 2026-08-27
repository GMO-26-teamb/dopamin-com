import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // dev.ts はローカル開発専用のサーバー起動だけで、Vercel 上でも使われない。
      // テストからは起動しないので、含めると下限を無意味に押し下げる
      exclude: ["src/**/*.test.ts", "src/dev.ts"],
      reporter: ["text", "json-summary"],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
