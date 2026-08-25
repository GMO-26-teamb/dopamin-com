# ADR-0001: モノレポのツールチェーン選定

- 日付: 2026-08-25
- 状態: 採用
- 関連: `docs/requirements.md` §7 / §8 / §16

## 決定

1. **TypeScript は 6.0 系を使う（7.0 は採用しない）**
   - TS 7.0（Go 製ネイティブ版）は JS の Compiler API を提供しない（7.1 で提供予定）。
   - Next.js 16.3 は `tsc` CLI 経由で型チェックできるが、`@vercel/node` などの周辺ツールが JS API に依存しており、ハッカソン期間中の不確実性を避ける。
   - 移行は `typescript@^7` に上げるだけ（Next.js 側は `experimental.useTypeScriptCli` が既定で有効）。
2. **内部パッケージ（`packages/*`）は TS ソースを直接 export する（Just-in-Time 方式）**
   - ビルド工程・`tsc --watch` が不要で、変更が即座に反映される。
   - `apps/web` は `next.config.ts` の `transpilePackages` で取り込む。
3. **`apps/api` はデプロイ時に `tsup` で 1 ファイルにバンドルする**
   - Vercel の Hono ビルダー（`@vercel/hono` → `@vercel/node`）はバンドルせず、`.ts` をファイル単位で変換して `.js` にリネームする。
     そのため `exports` が `./src/index.ts` を指す JIT パッケージは本番でのみ解決に失敗する。
   - `tsup` の `noExternal: [/^@dopamin\//]` でワークスペースパッケージを取り込み、`vercel.json` の `outputDirectory: "dist"` でビルド済み `dist/index.js` をエントリにする。
   - `hono` は外部参照のまま残す（ビルダーがエントリ内の `from "hono"` を検出するため）。
4. **Lint / Format はルートの `biome.json` 1 つで全パッケージに適用する**
   - Biome v2 はルート設定を配下に適用できるため、`packages/biome-config` は作らない。
   - `pnpm lint` はルートで 1 回実行し、typecheck / test / build のみ Turborepo で並列化する。

## 却下した案

- **各パッケージを `tsc` で `dist` にビルドする（Compiled Packages）**: Vercel 公式の Turborepo + Hono 例と同形だが、開発時に `tsc --watch` が必要で反映が遅れる。
- **`exports` を存在しない `./src/index.js` にして nft の `.js → .ts` 解決に頼る**: 動くが意図が読み取れず壊れやすい。
- **API を Next.js の Route Handler にマウント**: Web / API の分離（§6.3）と衝突する。Cookie / rewrites が本番で通らない場合の代替案として保持。

## 影響

- `pnpm build` は `next build` と `tsup` を実行する。CI で毎回バンドル可否が検証される。
- `apps/api` に新しいワークスペース依存（`@dopamin/db` など）を追加しても `tsup.config.ts` の変更は不要。
