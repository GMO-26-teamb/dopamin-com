# ドパ民.com — エージェント向け規約

## まず読む

- `docs/requirements.md` が要件の SSOT。機能単位の詳細は `docs/specs/<feature>.md`（要件ID `FR-xx` / `NFR-xx` を参照）。新規に書く場合は `docs/specs/_template.md` をコピーする。
- 優先順位: 本書 < `docs/specs/*` < `docs/requirements.md` < レジストリの Swagger UI（API 仕様の正）。
- `【要確認】` は未確定事項。推測で実装せず、確認して requirements.md を更新してから進める。
- 1 タスク = 1 spec = 1 PR。`pnpm check` がグリーンでない変更は main に入れない。
- **実装・修正の依頼を受けたら、着手前に必ず `issue-checker` サブエージェント（`.claude/agents/issue-checker.md`）で既存 issue に該当するかを確認する。** 該当 issue があればその番号に紐づけて進め（ブランチ・PR で issue を参照）、`blocked:要確認` 付きなら解消してから着手する。該当がなければ新規 issue を起票してから着手する。

## 構成（Turborepo + pnpm workspaces）

| パス | パッケージ | 役割 |
|---|---|---|
| `apps/web` | `@dopamin/web` | Next.js 16（App Router）。ビジネスロジックを持たない |
| `apps/api` | `@dopamin/api` | Hono（Vercel Functions, Node.js）。`/api/v1/*`、`AppType` を export |
| `packages/shared` | `@dopamin/shared` | zod スキーマ・型・定数・導出ロジック |
| `packages/db` | `@dopamin/db` | Drizzle スキーマ・マイグレーション・クライアント |
| `packages/registry` | `@dopamin/registry` | `RegistryAdapter` IF と kitaqsign / kitaqnic / mock 実装 |
| `packages/tsconfig` | `@dopamin/tsconfig` | 共有 `tsconfig` ベース |

- 内部パッケージは TS ソースをそのまま export する（ビルド不要）。`apps/web` は `transpilePackages`、`apps/api` は `tsup` で取り込む。
- `apps/web` ↔ `apps/api` は Hono RPC（`hc<AppType>`）。ブラウザは同一オリジンの `/api/*` を叩き、`next.config.ts` の rewrites で API に転送する。
- Lint / Format はルートの `biome.json` 1 つで全パッケージに適用する。

## コマンド

| コマンド | 内容 |
|---|---|
| `pnpm dev` | web（:3000）と api（:8787）を同時起動 |
| `pnpm check` | Biome（lint + format）→ typecheck → test。PR 前に必須 |
| `pnpm lint` / `pnpm format` | Biome チェック / 自動修正 |
| `pnpm test` | Vitest（全パッケージ） |
| `pnpm build` | Next.js ビルド + API バンドル |
| `pnpm db:generate` / `pnpm db:migrate` | Drizzle マイグレーション生成 / 適用（`DIRECT_DATABASE_URL` が必要） |

副作用や前提がある実行は上の表から外してある。使う前に [`docs/testing.md`](docs/testing.md) を読むこと。

| コマンド | 内容 |
|---|---|
| `pnpm --filter @dopamin/api test:connect` | **実レジストリに接続する**疎通テスト。ドメインを実際に登録・削除するので副作用がある。`apps/api/.env.local` の認証情報が必要（`docs/testing.md` §2） |
| `pnpm --filter @dopamin/shared test:perf` | 性能テスト（FR-05 / AC-05-3）。他の負荷と同居させると測れないので `pnpm test` からは外してある（`docs/testing.md` §1） |
| `pnpm --filter @dopamin/web e2e` | Playwright e2e（FR-01）。Chromium と Postgres が必要（`docs/testing.md` §3） |

環境変数は各 app の `.env.example` を `.env.local` にコピーして設定する。

## 規約

- TypeScript `strict`。`any` 禁止（Biome で error）。識別子は英語、コメント・spec は日本語可。
- すべての外部入力（HTTP・レジストリ応答・AI 出力・GitHub 応答）は zod で検証してから使う。AI 出力は必ず再検証する。
- 秘密情報（レジストリ認証・AI キー・GitHub トークン）は `apps/api` の環境変数のみ。クライアントに出さない。
- レジストリ固有の処理は `packages/registry` の外に書かない。正規化型（`packages/shared`）を変える場合は ADR を書く。
- ロジック変更にはテストを伴う。契約テストの fixture は `docs/registry/**`。
- 大きな設計判断は `docs/adr/` に ADR を残す。
- issue は `.github/ISSUE_TEMPLATE/`（feature / bug）、PR は `.github/PULL_REQUEST_TEMPLATE.md` の雛形に従う。
- `apps/web/AGENTS.md` / `apps/web/CLAUDE.md` は `next dev` が自動生成・再追記するファイル。**消さずにコミットしてよい**（手で書いた内容ではないので、差分が出ても驚かなくてよい）。

## 禁止

- `main` への直接 push（ブランチは `feat/<fr-id>-<slug>` / `fix/...` / `docs/...`、Conventional Commits）
- `.env.local` のコミット
- 実在の個人情報の投入（コンタクト情報はダミー値のみ）
