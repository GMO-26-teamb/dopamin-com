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

## デプロイ（Vercel）

`main` への push で本番を `.github/workflows/deploy.yml` からデプロイする（PR プレビューはなし。Git 連携は使わない。詳細は `docs/requirements.md` §16）。

初回セットアップ:

1. Vercel に `dopamin-web`（Root Directory: `apps/web`）と `dopamin-api`（Root Directory: `apps/api`）の 2 プロジェクトを作成する（Git 連携なし）。
2. 各プロジェクトの環境変数を設定する（Web: `API_ORIGIN=https://dopamin-api.ut42tech.com`、`NEXT_PUBLIC_APP_ORIGIN=https://dopamin.ut42tech.com` など。§17 参照）。
3. GitHub リポジトリの Secrets に以下を登録する。
   - `VERCEL_TOKEN` — Vercel のアクセストークン
   - `VERCEL_ORG_ID` — チーム/個人の ID（`vercel link` 後の `.vercel/project.json` の `orgId`）
   - `VERCEL_PROJECT_ID_WEB` / `VERCEL_PROJECT_ID_API` — 各プロジェクトの `projectId`
