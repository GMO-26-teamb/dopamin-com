import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const projectRoot = fileURLToPath(new URL(".", import.meta.url)).replace(
  /\/$/,
  "",
);

export default defineConfig({
  plugins: [react()],
  resolve: {
    // tsconfig の paths（"@/*": ["./*"]）に合わせる
    alias: { "@": projectRoot },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./test/setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/.next/**"],
    /*
     * CI（2 コアの共有 runner）では turbo が api / web / shared のテストと next build を
     * 同時に走らせるため、jsdom + Testing Library の非同期待ち（`findBy*` / `waitFor`）が
     * vitest の既定 5 秒を超えて落ちることがある（#137）。ここで測っているのは
     * 「所要時間」ではなく「最終的にその UI になること」なので、予算を伸ばしても
     * 検証は弱まらない（本当に描画されなければ延ばした時間のぶんだけ待って落ちる）。
     * 時間そのものを検証する性能テストは packages/shared 側で別建てにしてある（#181）。
     */
    testTimeout: 10_000,
    hookTimeout: 30_000,
  },
});
