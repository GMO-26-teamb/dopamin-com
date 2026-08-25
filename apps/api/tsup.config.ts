import { defineConfig } from "tsup";

/**
 * Vercel デプロイ用に 1 ファイルへバンドルする。
 * @vercel/node はバンドルせず .ts を .js にリネームするだけなので、
 * TS ソースを直接 export しているワークスペースパッケージ（@dopamin/*）はここで取り込む。
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  noExternal: [/^@dopamin\//],
  sourcemap: true,
  clean: true,
});
