# ドパ民.com（dopamin.com）

Z世代向けドメイン管理プラットフォーム（疑似レジストラ）。要件は [`docs/requirements.md`](docs/requirements.md)、開発規約は [`CLAUDE.md`](CLAUDE.md) を参照。

## セットアップ

```sh
# Node.js 22+ / pnpm 11
pnpm install
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env.local
pnpm dev   # web: http://localhost:3000 / api: http://localhost:8787
```

## よく使うコマンド

- `pnpm check` — lint / format / typecheck / test（PR 前に必須）
- `pnpm build` — 全パッケージのビルド
- `pnpm db:generate` / `pnpm db:migrate` — Drizzle マイグレーション
- `pnpm --filter @dopamin/api test:connect` — 実レジストリ疎通テスト（**実データに反映される**。実行条件は [`docs/testing.md`](docs/testing.md) を必読）

## フロントエンド開発

既定はモックモード（`NEXT_PUBLIC_API_MODE=mock`）。API なしで全画面・全状態をレビューでき、`http` を明示したときだけ実 API を叩く（不正値はビルド / 起動時に例外）。

URL の `?mock=<scenario>` で状態を切り替える（`apps/web/lib/api/mock/scenario.ts`）:

- `default` — fixtures どおり（未指定・不正値もこれ）
- `empty` — 一覧が空（S-11 / S-51 / S-62）
- `loading` — 応答を 10 秒待たせる（Skeleton の確認）
- `error` — 参照・更新がエラー（S-13 / S-28 / S-53）
- `ai-timeout` — AI がタイムアウト（S-23 / S-41）
- `partial-failure` — 一部の行だけ確認不可（AC-03-2 / AC-05-2）
- `stale` — キャッシュ表示（同期失敗、S-13 / S-31）
- `ns-fail` — NS 切替に失敗して DNS も変更しない（S-46）
- `conflict` — 登録が競合（S-27）
- `unsupported` — WebAuthn 非対応ブラウザ（S-01c / S-02c）

- デザイントークン: `pnpm --filter @dopamin/web tokens` で `lib/theme/tokens.json` から `app/tokens.css` を再生成する（手で `tokens.css` を編集しない）。
- 設計ドキュメント: [`docs/superpowers/specs/2026-08-26-fe-ui-design.md`](docs/superpowers/specs/2026-08-26-fe-ui-design.md)（データ層・コンポーネント）、[`docs/specs/ui-screens.md`](docs/specs/ui-screens.md)（画面 ID と文言）、[`docs/ui-design/`](docs/ui-design/)（Figma の書き出し）。

## デプロイ（Vercel）

`main` への push で本番を `.github/workflows/deploy.yml` からデプロイする（PR プレビューはなし。Git 連携は使わない。詳細は `docs/requirements.md` §16）。

初回セットアップ:

1. Vercel に `dopamin-web`（Root Directory: `apps/web`）と `dopamin-api`（Root Directory: `apps/api`）の 2 プロジェクトを作成する（Git 連携なし）。
2. 各プロジェクトの環境変数を設定する（Web: `API_ORIGIN=https://dopamin-api.ut42tech.com`、`NEXT_PUBLIC_APP_ORIGIN=https://dopamin.ut42tech.com` など。§17 参照）。
3. GitHub リポジトリの Secrets に以下を登録する。
   - `VERCEL_TOKEN` — Vercel のアクセストークン
   - `VERCEL_ORG_ID` — チーム/個人の ID（`vercel link` 後の `.vercel/project.json` の `orgId`）
   - `VERCEL_PROJECT_ID_WEB` / `VERCEL_PROJECT_ID_API` — 各プロジェクトの `projectId`
