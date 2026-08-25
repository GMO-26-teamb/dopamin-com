---
marp: true
theme: default
paginate: true
header: "ドパ民.com — Day3 朝の引き継ぎ（夜間自動実装の結果）"
footer: "2026-08-26 Day3 朝会 / チーム B"
---

# ドパ民.com
## Day3 朝の引き継ぎ — 夜間（8/25 深夜〜8/26 朝）の成果

作業者: Claude Code（上原の指示で自走） / 対象: FE 全画面 + shared + docs

---

## 到達点（すべて `main` に集約済み）

| 領域 | 結果 |
|---|---|
| FE UI Foundation（トークン・プリミティブ・データ層・AppShell） | ✅ PR #99 |
| FE 全画面（S-00〜S-81 / D-01〜D-10 / P-01、モックで動く） | ✅ PR #100〜#107 |
| 統合 QA（CI 修正・重複統合・19 画面スモーク・スクショ） | ✅ PR #118 |
| shared: displayStatus / TLD 表 / 日付導出 / isOperationAllowed 拡張 / FR-13 zod / ログ・設定 zod | ✅ PR #108 #109 #111 #115 #119 |
| docs: 要件 v0.1.5→v0.1.7、web-ui.md、テンプレート | ✅ PR #98 #110 #114 |
| infra/api: Node 22 固定、api env §17 準拠 | ✅ PR #112 #116 |

- マージ済み PR **22 件**（#98〜#119）、クローズした issue **33 件**（web 系 #74〜#94 ほか）
- `pnpm check` / `pnpm --filter @dopamin/web build` グリーン、CI グリーン（後述の注意あり）

---

## 今 `main` で動くもの（モックモード）

```sh
pnpm install && pnpm dev            # http://localhost:3000（API 不要）
```

- 既定は `NEXT_PUBLIC_API_MODE=mock`。`?mock=empty|loading|error|stale|ai-timeout|partial-failure|ns-fail|conflict|unsupported` で各状態を再現
- 画面: `/` → `/signup` `/login` → `/dashboard` → `/domains/new` → `/domains/<name>`（更新・NS・廃止・復旧・AuthCode・承認）→ `/domains/<name>/subdomains`（提案→保存→DNS 反映）→ `/transfers` → `/logs` → `/settings`
- スクショ: `docs/ui-design/qa/2026-08-26/`（19 枚、コンソールエラー 0）
- 実 API に切替: `NEXT_PUBLIC_API_MODE=http`（`apps/web/lib/api/http/http-services.ts` が Hono RPC + zod。未実装ルートは `NOT_IMPLEMENTED` を返す）

---

## Backend 接続のための「差し込み口」

| 場所 | 役割 |
|---|---|
| `apps/web/lib/api/services.ts` | Service IF（Auth / Domain / Candidate / Subdomain / Transfer / Log / Settings） |
| `apps/web/lib/api/http/http-services.ts` | 実 API 実装。`unwrap(request, schema)` で zod 検証 → `ApiClientError` に正規化。**未実装ルートを埋めるだけで画面が動く** |
| `apps/web/lib/api/types.ts` | 画面 ViewModel（`packages/shared` の zod から 1:1 で導出する設計） |
| `packages/shared` | `deriveDisplayStatus` / `isOperationAllowed` / `daysUntil` / TLD / FR-13 zod / ログ・設定 zod（API 側もこれを使う） |
| `apps/web/lib/error-messages.ts` | エラー文言の SSOT（FR-18 の必須文を自動付与、AI 由来は `origin: "ai"`） |

API 側で `GET /domains`・`GET /domains/:name`・`/transfers`・`/logs/*`・`/auth/me`（`features.demoReset` / `ai.providers`）が揃うと http モードで全画面が動く見込み。

---

## 残っている issue（優先度順・担当目安）

**P0（M1 必須）— API / registry / db（佐々木・星）**
- #26 正規化型拡張（ADR 込み）→ #43 #44 #45 registry 移管 → #50〜#58 API（一覧 / 詳細 / 所有権 / 移管 / Poll）→ #59 統合テスト
- #33 #34 db カラム追加、#39 deploy 前マイグレーション、#40 テスト DB、#47 #55 #60（good first）

**P1 — 差別化**
- AI: #65 → #66（候補生成）#67（独自性スコア）/ #28（スコア純粋関数・shared）
- FR-13 API: #68 #69 #70（web は実装済み・`GET /dns` 接続待ち）
- ログ/設定: #63 #64 #71 #72 #73 / db #35 #36 #37 #38
- web: #95（a11y・レスポンシブ）、#41（e2e）、#19（発表前チェックリスト）、#30（エラーコード二重定義）

**docs / 要確認**: #16（v0.1.5 は済、**ADR のみ未**）、#17（運営確認 §21.2）、#20 #21

---

## FE 側の既知フォローアップ（issue 未起票・小粒）

- ダッシュボードのカード操作を D-01/D-04/D-02 ダイアログに直結（今は詳細へ遷移）
- `?mock=stale` が全ドメインを stale 扱い（本来はレジストリ単位）
- http モード: `settings.me` / AI 系が `NOT_IMPLEMENTED`、AI ルート実装時は `origin: "ai"` を立てる
- `ui-screens.md` S-23: Banner か ErrorCard か表記揺れ（現状 ErrorCard）
- サイドバーのテーマ切替が 190px で 2 行に折り返す（デザイン判断待ち）
- `docs/requirements.md` §6.4 の「routing.ts が TLD を持つ」記述が古い（#32 で shared へ移設済み）
- API 側 `isOperationAllowed` 呼び出しに `ownership / transfer / rgpStatuses` を渡す（#54 にコメント済み）
- web ViewModel と shared zod の命名差（`items/hosts`、`applyState/applyStatus`、`AiLog.tokens` 等）は API 結線時に寄せる（各 PR 本文に対応表あり）

---

## 開発上の注意（今朝ハマらないために）

- **CI**: `packages/shared` の `daysUntil` テストが UTC で落ちていた問題は #117 で修正済み。web の dialog 系テストは **CPU 高負荷時に 5s タイムアウト**することがある（並列 vitest を避ける / 再実行で通る）
- **git stash は worktree 間で共有**される。並列作業中は `git stash` を使わない（夜間に 2 度衝突）。turbo キャッシュも共有 → 検証は `--force`
- `.claude/worktrees/agent-*` は夜間エージェントの残骸。`git worktree prune` 前に中身が不要か確認（全て push 済み）
- `GitHub の "Closes #a, #b"` は 2 つ目以降を閉じないことがある → マージ後に `gh issue close`
- Node は `.nvmrc` = 22（ローカル 24 でも warning のみ）。Vercel も 22.x

---

## 今日の提案（Day3）

1. **朝会**: 佐々木 → #26 → #43〜#45 → #50〜#53（API 一覧・詳細）を最優先。星 → #33 #34 #39 #40（db/infra）→ #67 独自性スコア
2. **上原**: http モードで `/dashboard` `/domains/<name>` を実 API に接続（`http-services.ts` の `NOT_IMPLEMENTED` を順に埋める）、#95 a11y、発表資料
3. **夕方ゴール**: 本番で ログイン → 一覧 → 検索 → 登録 が動く（モックの画面は全部あるので、API が返れば繋がる）
