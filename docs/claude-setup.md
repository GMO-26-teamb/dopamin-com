# Claude Code チームセットアップ

このリポジトリで Claude Code を使うための共有設定。リポジトリに含まれる設定は clone するだけで有効になる（初回起動時に承認プロンプトが出る）。

## リポジトリに含まれるもの（自動で有効）

| ファイル | 内容 |
|---|---|
| `CLAUDE.md` | エージェント向け規約（要件の SSOT、構成、コマンド、禁止事項） |
| `.claude/settings.json` | チーム共通で有効にするプラグイン一覧。初回起動時にインストールを促される |
| `.mcp.json` | プロジェクトスコープの MCP サーバ（Supabase / Chrome DevTools）。初回起動時に承認を求められる |

個人用の上書きは `.claude/settings.local.json`（gitignore 済み）に書く。

## プラグイン（`.claude/settings.json`）

すべて公式マーケットプレイス `anthropics/claude-plugins-official` のもの。手動で入れる場合は `/plugin install <name>@claude-plugins-official`。

| プラグイン | 用途 | 主なコマンド / 挙動 |
|---|---|---|
| `superpowers` | 開発プロセスの型（ブレスト → 計画 → TDD → 検証 → レビュー）を強制 | 自動で該当スキルが発動。`brainstorming` / `writing-plans` / `test-driven-development` / `systematic-debugging` など |
| `context7` | ライブラリの最新ドキュメント参照（Next.js 16 / Hono / Drizzle / zod など） | Claude が質問時に自動で引く |
| `serena` | LSP ベースのシンボル検索・編集（大規模な参照追跡・リネーム） | 自動。初回はプロジェクトのオンボーディングが走る |
| `code-review` | PR / diff のレビュー | `/code-review`、`/code-review ultra`（クラウド多エージェント・課金） |
| `code-simplifier` | 変更コードの簡素化・整理 | `/simplify`、`code-simplifier` エージェント |
| `feature-dev` | 機能開発ガイド（コード探索 → 設計 → 実装 → レビュー） | `/feature-dev` |
| `security-guidance` | 危険なコード変更時の注意喚起（フック） | 自動 |
| `vercel` | デプロイ・env・ログ・Next.js/Turbopack/Functions の知識 | `/vercel:deploy` `/vercel:env` `/vercel:status` ほか。Vercel MCP 同梱 |
| `frontend-design` | テンプレ臭くない UI 設計指針 | 自動（UI 作成時） |
| `claude-md-management` | CLAUDE.md の改善・監査 | `/revise-claude-md`、`claude-md-improver` |
| `claude-code-setup` | このプロジェクト向けの hooks / skills / MCP の推奨 | `claude-automation-recommender` |
| `figma` | Figma デザイン ↔ コード（design-to-code、Code Connect） | Figma MCP 同梱。要 Figma ログイン |
| `exa` | Web 検索・リサーチ | `/exa:search` |

## MCP サーバ（`.mcp.json`）

| サーバ | 用途 | 前提 |
|---|---|---|
| `supabase` | テーブル一覧・SQL 実行・ログ・アドバイザ（Supabase Postgres 用） | 初回起動時にブラウザで Supabase にログイン（OAuth）。本番 DB への `apply_migration` は使わず、マイグレーションは `pnpm db:migrate` で行う |
| `chrome-devtools` | ローカルで起動した web のスクリーンショット・コンソール・ネットワーク確認 | Node.js / Chrome |

プラグイン同梱の MCP（context7 / vercel / figma / serena / exa）は上記に加えて自動で有効になる。

## 推奨の個人設定（任意・共有対象外）

`~/.claude/settings.json` に書く。チームでは強制しない。

- `"effortLevel": "high"` — 推論の深さ。
- `"model": "claude-fable-5[1m]"` — 1M コンテキスト。
- `warp@claude-code-warp` プラグイン — Warp ターミナル利用者向け。marketplace `warpdotdev/claude-code-warp` を追加してから install。
- Docker MCP Toolkit（`docker mcp gateway run --profile coding`） — Docker Desktop の MCP ゲートウェイ経由で fetch / memory / npm 調査 / Next.js docs など多数のツールをまとめて使う。Docker Desktop が必要。
- Claude in Chrome 拡張 — 実ブラウザ操作（claude-in-chrome MCP）。

## 使い方の流れ（このリポジトリの規約に沿って）

1. `docs/requirements.md` と `docs/specs/<feature>.md` を読ませる（`CLAUDE.md` で指示済み）。
2. 実装依頼は `superpowers` の流れに乗せる: brainstorming → plan → TDD で実装。
3. 完了前に `pnpm check`、`/code-review` でレビュー、`/simplify` で整理。
4. `feat/<fr-id>-<slug>` ブランチで PR。`main` へ直接 push しない。

## 確認コマンド

```
/plugin          # プラグインの有効状態
/mcp             # MCP サーバの接続状態・認証
/doctor          # 環境診断
```
