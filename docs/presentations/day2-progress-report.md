---
marp: true
theme: default
paginate: true
header: "ドパ民.com — Day2 進捗報告"
footer: "2026-08-26 Day3 朝会 / チーム B"
---

# ドパ民.com
## Day2 進捗報告（8/25）

チーム B：上原・佐々木・星

---

## Day2 の到達点

| ゴール | 結果 |
|---|---|
| 開発基盤（モノレポ / CI/CD / 本番デプロイ） | ✅ 完了 |
| DB・パスキー認証（FR-01） | ✅ マージ済み |
| レジストリ連携 API | 🟡 PR #12 オープン・コンフリクト解消待ち |
| UI デザイン | 🟡 Figma 化まで完了・実装は Day3 |

- マージ済み PR **10 件** / オープン 2 件、テスト **24 件全通過**
- 本番: `dopamin.ut42tech.com` / `dopamin-api.ut42tech.com`

---

## Day2 でやったこと

**上原** — 基盤・CI/CD・UI
- Turborepo モノレポ（Hono + Next.js）、GitHub Actions でビルドチェック＋ Vercel デプロイ
- UI を Claude Design で作成 → MCP で Figma へ。要件 v0.1.4（FR-12 他チーム移管）。PR レビュー 4 件

**佐々木** — ドキュメント・API
- 資料の Markdown 化、Claude Code skills 整備（要件変更ガード）
- レジストリ API 仕様を実測で更新、接続テスト成功。API 実装（#12）はコンフリクト解消が残り

**星** — DB・認証
- Supabase 構築、P0 テーブルのマイグレーション（8 テーブル）
- パスキー認証 FR-01 を API / Web ともに実装・マージ。transfers / operation_logs（#13）

---

## 課題

- **#12 のコンフリクト解消** — main（パスキー認証・requestId）と衝突。Day3 朝いちでマージ
- **Web は認証画面のみ** — ドメイン一覧・操作画面は Figma 止まり
- **AI 機能（FR-04 / FR-05 / FR-13）は未着手** — 機能要件を改めて確認してから実装

---

## Day3 の分担

| 担当 | やること |
|---|---|
| 上原 | UX 改善（Figma → Next.js）、PR レビュー、**発表スライド** |
| 佐々木 | **API とフロントエンドの接続**（#12 マージ → Hono RPC で Web から呼び出し） |
| 星 | **独自性スコア（FR-05）の実装**、発表スライド |
| 未割当 | **AI 機能**（FR-04 ドメイン候補生成 / FR-13 サブドメイン設計支援 / FR-14 AI ログ）— 要件を再確認して着手 |

**Day3 ゴール：ログイン → ドメイン検索 → 登録 / 移管 を本番で E2E、＋ 独自性スコア表示**

---

## まとめ

- Day2 で **基盤・DB・認証** が揃い本番稼働、Day3 から **機能実装＋AI** フェーズへ
- 運用: 1 タスク = 1 spec = 1 PR、`pnpm check` グリーン、要件変更は先に requirements.md
