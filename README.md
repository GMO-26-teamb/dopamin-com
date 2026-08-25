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
