# ドパ民.com

> 考えるのは楽しく、設定は考えなくていい。

Z世代向けのドメイン管理プラットフォーム（疑似レジストラ）。ドメインを初めて取る個人開発者が、
**「決める」ことだけ楽しみ、「設定」は考えずに済む**ことを狙っている。
ニックネームを入れると AI が候補を出し、空き状況と「既存サービスとの紛らわしさ」を並べて見せ、
取得したあとの運用（更新・情報修正・廃止・復旧・移管・サブドメイン設計）まで 1 つの画面でつながる。

GMO Internet Internship in kitaQ（2026/08/24–28）チームドパ民（Team B）の成果物。
疑似レジストリ **Kitaqsign / Kitaqnic** への EPP 相当コマンド（HTTP/REST + JSON）で実際に動く。

## 何が新しいか

| | 内容 | 要件 |
|---|---|---|
| **AI ドメイン候補生成** | ニックネームやアプリ名から候補を最大 6 件。1 件ごとに 40 字の理由が付く。空き確認と独自性スコアを添えて返すので、そのまま取得に進める | FR-04 |
| **独自性スコア** | 名前の独自性を 0〜100 で出す（既存の有名サービスに紛らわしいほど低い）。表記・読み（ローマ字）・leet の揺れを見る lexical 方式で、埋め込みモデルは使わない（[ADR-0003](docs/adr/0003-uniqueness-lexical-scoring.md)）。**ランディングではログインなしで試せる** | FR-05 |
| **サブドメイン設計支援** | GitHub の公開リポジトリ URL（またはプロジェクト概要）から `api.` / `docs.` などの構成を AI が提案。編集して保存し、ボタン 1 つでアプリ内の疑似 DNS ゾーンに反映する。反映時のネームサーバー切替だけは実レジストリに効く（[ADR-0004](docs/adr/0004-pseudo-dns-zone.md)） | FR-13 |

ほかに、パスキー認証（パスワードもメールアドレスも持たない・FR-01）、
2 レジストリ 22 TLD の空き確認（FR-03）、取得 / 更新 / 情報修正 / 廃止 / 復旧（FR-06〜FR-11）、
他レジストラとの移管 IN / OUT（FR-12）、レジストリ通信と AI 呼び出しの全ログ（FR-14 / FR-15）、
モック決済のお支払い画面（FR-19）を実装している。詳細は
[`docs/requirements.md`](docs/requirements.md)。

## 動かす

Node.js 22（`.nvmrc`）と pnpm 11 が要る。

```sh
pnpm install
pnpm dev   # web: http://localhost:3000 / api: http://localhost:8787
```

**環境変数なしで全画面が見られる。** web の既定はモックモード（`NEXT_PUBLIC_API_MODE` 未設定 = `mock`）で、
ブラウザ内のモックサービスだけで動くため、DB もレジストリの認証情報も要らない。
UI のレビューはこれで完結する。

実 API に繋ぐときだけ設定ファイルを用意する。

```sh
cp apps/web/.env.example apps/web/.env.local   # NEXT_PUBLIC_API_MODE=http にする
cp apps/api/.env.example apps/api/.env.local   # DATABASE_URL / WebAuthn / レジストリ認証情報 など
```

- `apps/api/.env.example` の各項目にコメントで用途と値域が書いてある。
- レジストリ認証情報が無くても `REGISTRY_MODE=mock` で API 側のモックレジストリが動く。
- AI 機能（FR-04 / FR-13）はプロバイダのキーか `AI_GATEWAY_API_KEY` が 1 本要る。無いと 503 になる（[`docs/specs/ai-gateway.md`](docs/specs/ai-gateway.md)）。

## リポジトリ構成（Turborepo + pnpm workspaces）

| パス | パッケージ | 役割 |
|---|---|---|
| `apps/web` | `@dopamin/web` | Next.js 16（App Router）。ビジネスロジックを持たない |
| `apps/api` | `@dopamin/api` | Hono（Vercel Functions, Node.js）。`/api/v1/*`、`AppType` を export |
| `packages/shared` | `@dopamin/shared` | zod スキーマ・型・定数・導出ロジック |
| `packages/db` | `@dopamin/db` | Drizzle スキーマ・マイグレーション・クライアント |
| `packages/registry` | `@dopamin/registry` | `RegistryAdapter` IF と kitaqsign / kitaqnic / mock 実装 |
| `packages/tsconfig` | `@dopamin/tsconfig` | 共有 `tsconfig` ベース |

内部パッケージは TS ソースをそのまま export する（ビルド不要）。
`apps/web` ↔ `apps/api` は Hono RPC（`hc<AppType>`）で、ブラウザは同一オリジンの `/api/*` だけを叩き、
`next.config.ts` の rewrites が API に転送する。設計の経緯は [ADR-0001](docs/adr/0001-monorepo-toolchain.md)。

## コマンド

| コマンド | 内容 |
|---|---|
| `pnpm dev` | web（:3000）と api（:8787）を同時起動 |
| `pnpm check` | Biome（lint + format）→ typecheck → test。**PR 前に必須** |
| `pnpm lint` / `pnpm format` | Biome チェック / 自動修正 |
| `pnpm test` | Vitest（全パッケージ） |
| `pnpm build` | Next.js ビルド + API バンドル |
| `pnpm db:generate` / `pnpm db:migrate` | Drizzle マイグレーション生成 / 適用（`DIRECT_DATABASE_URL` が要る） |

副作用や前提のある実行は上の表から外してある。使う前に [`docs/testing.md`](docs/testing.md) を読むこと。

| コマンド | 内容 |
|---|---|
| `pnpm --filter @dopamin/api test:connect` | **実レジストリに接続する**疎通テスト。ドメインを実際に登録・削除する（testing.md §2） |
| `pnpm --filter @dopamin/shared test:perf` | 性能テスト（FR-05 / AC-05-3）。他の負荷と同居させると測れないので `pnpm test` から外してある（§1） |
| `pnpm --filter @dopamin/web e2e` | Playwright e2e（FR-01）。Chromium と Postgres が要る（§3） |
| `pnpm --filter @dopamin/web tokens` | `lib/theme/tokens.json` から `app/tokens.css` を再生成（`tokens.css` を手で編集しない） |

## ドキュメント

| | 内容 |
|---|---|
| [`docs/requirements.md`](docs/requirements.md) | **要件の SSOT**。機能要件 FR-xx / 非機能 NFR-xx / API 一覧 / データモデル / 環境変数。迷ったらここが正 |
| [`docs/specs/`](docs/specs/) | 機能単位の実装仕様。`FR-xx` を参照する。新規は [`_template.md`](docs/specs/_template.md) をコピーする |
| [`docs/adr/`](docs/adr/) | 大きな設計判断の記録（モノレポ構成 / 移管の正規化型 / 独自性スコアの方式 / 疑似 DNS ゾーン） |
| [`docs/testing.md`](docs/testing.md) | テストの実行方法。副作用のある疎通テスト・e2e の前提もここ |
| [`docs/registry/`](docs/registry/) | レジストリの OpenAPI と実測メモ（`spec-notes.md`）、契約テストの fixture |
| [`docs/ui-design/`](docs/ui-design/) | Figma のページ構成と書き出し画像 |
| [`docs/claude-setup.md`](docs/claude-setup.md) | Claude Code の共有設定（プラグイン / hooks / スキル / MCP） |
| [`CLAUDE.md`](CLAUDE.md) | エージェント向け規約。人間の開発者にもそのまま当てはまる |

優先順位は `CLAUDE.md` < `docs/specs/*` < `docs/requirements.md` < レジストリの Swagger UI。
`【要確認】` は未確定事項で、推測で実装せず要件書を更新してから進める。

主な spec: [`ui-screens.md`](docs/specs/ui-screens.md)（全画面の ID・状態・文言）/
[`registry-api.md`](docs/specs/registry-api.md)（レジストリ連携）/
[`passkey-auth.md`](docs/specs/passkey-auth.md)（FR-01）/
[`ai-candidates.md`](docs/specs/ai-candidates.md)（FR-04）/
[`subdomain-plan.md`](docs/specs/subdomain-plan.md)（FR-13）/
[`manual-checklist.md`](docs/specs/manual-checklist.md)（発表前日の手動確認）。

## フロントエンド開発

モックモードでは URL の `?mock=<scenario>` で状態を切り替えられる（`apps/web/lib/api/mock/scenario.ts`）。

| シナリオ | 再現する状態 |
|---|---|
| `default` | fixtures どおり（未指定・不正値もこれ） |
| `empty` | 一覧が空（S-11 / S-51 / S-62） |
| `loading` | 応答を 10 秒待たせる（Skeleton の確認） |
| `error` | 参照・更新がエラー（S-13 / S-28 / S-53） |
| `ai-timeout` | AI がタイムアウト（S-23 / S-41） |
| `partial-failure` | 一部の行だけ確認不可（AC-03-2 / AC-05-2） |
| `stale` | キャッシュ表示（同期失敗、S-13 / S-31） |
| `ns-fail` | NS 切替に失敗して DNS も変更しない（S-46） |
| `conflict` | 登録が競合（S-27） |
| `unsupported` | WebAuthn 非対応ブラウザ（S-01c / S-02c） |

デザインの参照先は [`docs/specs/ui-screens.md`](docs/specs/ui-screens.md)（画面 ID と文言）/
[`docs/specs/web-ui.md`](docs/specs/web-ui.md)（Figma ノード ID・デザイントークン対応表）/
[`docs/superpowers/specs/2026-08-26-fe-ui-design.md`](docs/superpowers/specs/2026-08-26-fe-ui-design.md)（データ層・コンポーネント）。

## デプロイ（Vercel）

`main` への push で本番を `.github/workflows/deploy.yml` からデプロイする
（PR プレビューはなし。Git 連携は使わない。詳細は `docs/requirements.md` §16）。

初回セットアップ:

1. Vercel に `dopamin-web`（Root Directory: `apps/web`）と `dopamin-api`（Root Directory: `apps/api`）の 2 プロジェクトを作成する（Git 連携なし）。
2. 各プロジェクトの環境変数を設定する（Web: `API_ORIGIN=https://dopamin-api.ut42tech.com`、`NEXT_PUBLIC_API_MODE=http` など。§17 参照）。
3. GitHub リポジトリの Secrets に以下を登録する。
   - `VERCEL_TOKEN` — Vercel のアクセストークン
   - `VERCEL_ORG_ID` — チーム/個人の ID（`vercel link` 後の `.vercel/project.json` の `orgId`）
   - `VERCEL_PROJECT_ID_WEB` / `VERCEL_PROJECT_ID_API` — 各プロジェクトの `projectId`

デプロイは `api` → `web` の順に走る。本番は Web `https://dopamin.ut42tech.com` / API `https://dopamin-api.ut42tech.com`。

### マイグレーションの適用

**CI では自動適用しない**（`docs/requirements.md` §16.2）。スキーマを変更した PR は、次の順で担当者が手で当てる。

1. PR を `main` にマージする
2. ローカルで `main` を pull する
3. 本番 DB の接続文字列を渡して適用する（`drizzle.config.ts` は `.env` を読まないので環境変数で渡す）

   ```bash
   DIRECT_DATABASE_URL='postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres' pnpm db:migrate
   ```

4. `drizzle.__drizzle_migrations` の件数が `packages/db/drizzle/meta/_journal.json` のエントリ数と一致することを確認する

**マージ前のブランチから当ててはいけない。** drizzle は `_journal.json` の `when`（タイムスタンプ）で適用済みかを判定するため、当てたあとに `db:generate` をやり直して `when` が変わると同じ DDL が二重適用されて落ちる。

スキーマ変更を含む PR は、マージ後の適用が終わるまで本番が古いスキーマのままになる（API のデプロイは先に完了する）。後方互換のない変更は、適用後にデプロイをやり直すこと。

## 貢献の流れ

1 タスク = 1 spec = 1 PR。ブランチは `feat/<fr-id>-<slug>` / `fix/...` / `docs/...`（Conventional Commits）。
`main` への直接 push は禁止。`pnpm check` がグリーンでない変更は `main` に入れない。
詳細は [`CLAUDE.md`](CLAUDE.md)。
