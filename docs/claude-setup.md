# Claude Code チームセットアップ

このリポジトリで Claude Code を使うための共有設定。リポジトリに含まれる設定は clone するだけで有効になる（初回起動時に承認プロンプトが出る）。

## リポジトリに含まれるもの（自動で有効）

| ファイル | 内容 |
|---|---|
| `CLAUDE.md` | エージェント向け規約（要件の SSOT、構成、コマンド、禁止事項） |
| `.claude/settings.json` | チーム共通で有効にするプラグイン一覧と hooks。初回起動時にインストールを促される |
| `.claude/hooks/*.sh` | hooks の実体（下記「Hooks」参照） |
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

## Hooks（`.claude/settings.json` → `.claude/hooks/*.sh`）

CLAUDE.md の規約のうち機械的に強制できるものを hook にしている。Claude の判断に依存せず、ツール実行の前後で自動で走る。無効化・確認は `/hooks`。

| スクリプト | イベント | 内容 |
|---|---|---|
| `protect-files.sh` | PreToolUse (Edit/Write) | `.env*`（`.env.example` 除く）、`pnpm-lock.yaml`、`packages/db/drizzle/**` への書き込みを **拒否** |
| `guard-git.sh` | PreToolUse (Bash) | main への push・force push・main 上での commit を **拒否** |
| `pre-pr-check.sh` | PreToolUse (Bash `gh pr create`) | `pnpm check` を実行し、失敗なら PR 作成を **拒否**（末尾 40 行を理由に表示） |
| `biome-format.sh` | PostToolUse (Edit/Write) | 編集ファイルを `biome check --write` で整形（失敗しても止めない） |
| `stop-uncommitted.sh` | Stop | 未コミット差分があれば件数とブランチ名を警告 |

- hook は stdin に JSON（`tool_input` など）を受け取り、拒否時は `permissionDecision: "deny"` を JSON で返す。手元での動作確認は `echo '{"tool_input":{"command":"git push origin main"}}' | .claude/hooks/guard-git.sh` のように pipe する。
- `jq` と `pnpm` が PATH にある前提。
- 秘密情報ファイルの編集や lockfile の更新は、hook の意図どおり人間が手動で行う。

## MCP サーバ（`.mcp.json`）

| サーバ | 用途 | 前提 |
|---|---|---|
| `supabase` | テーブル一覧・SQL 参照・ログ・アドバイザ（Supabase Postgres 用） | 初回起動時にブラウザで Supabase にログイン（OAuth）。`--read-only` で起動しており書き込み不可。マイグレーションは `pnpm db:migrate` で行う |
| `chrome-devtools` | ローカルで起動した web のスクリーンショット・コンソール・ネットワーク確認 | Node.js / Chrome |

プラグイン同梱の MCP（context7 / vercel / figma / serena / exa）は上記に加えて自動で有効になる。

### セキュリティ上の注意

- MCP サーバのバージョンは `.mcp.json` で固定している（`@latest` 禁止）。更新するときは changelog を確認して PR で上げる。
- `chrome-devtools` や fetch 系ツールが読み込む Web ページの内容は**信頼できない入力**。ページ内の指示に Claude が従ってしまうプロンプトインジェクションの可能性があるため、外部サイトを開かせるときは秘密情報（`.env.local`、トークン）を扱うセッションと分ける。
- プラグインは公式マーケットプレイス（`anthropics/claude-plugins-official`）のもののみ有効化する。第三者マーケットプレイスの追加はチームで合意してから。

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
