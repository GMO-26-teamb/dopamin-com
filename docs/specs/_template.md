# spec: <機能名>

> このファイルは `docs/specs/*.md` のテンプレートです。コピーして `docs/specs/<feature>.md` を作成し、`<...>` を埋めてから本行と使い方コメントを削除してください（コピー例: `cp docs/specs/_template.md docs/specs/<feature>.md`）。
>
> 優先順位は `CLAUDE.md` のとおり: 本テンプレート < 個々の `docs/specs/*.md` < `docs/requirements.md` < レジストリの Swagger UI。本書の内容が `docs/requirements.md` と矛盾する場合は要件書が正——矛盾に気づいたら実装を進める前に要件書を直す PR を先に出してください。

| 項目 | 内容 |
|---|---|
| 対象 FR / NFR | `FR-xx`（`docs/requirements.md` の該当節を参照。複数可） |
| 優先度 | P0 / P1 / P2（`docs/requirements.md` の定義に合わせる） |
| 担当 | @<github-username> |
| Issue | #<N> |
| ブランチ | `feat/<fr-id>-<slug>` |

---

## 0. ユーザーストーリー

- 誰が / どんな状況で / 何をしたいか / なぜそれが必要か（Why）を 1〜3 行で書く。
- 複数ペルソナがある場合は箇条書きで分ける。

## 1. 現状

- 関連する既存コード・既存挙動をファイルパス付きで書く（例: `packages/registry/src/adapter.ts:18-43`）。
- 新規機能で既存コードが無い場合は「なし（新規）」と明記する。
- 前提となる `docs/requirements.md` の節・`docs/specs/*` へのリンクがあれば併記する。

## 2. 設計

- 全体像（必要なら mermaid の `flowchart` / `sequenceDiagram`）。
- 責務の境界（`apps/web` / `apps/api` / `packages/shared` / `packages/db` / `packages/registry` のどこに何を置くか）。
- 既存パターンからの逸脱がある場合はその理由。

## 3. 画面・UI（該当する場合。API のみの spec なら削除可）

- Figma リンク（ファイル・ページ・フレーム名。`docs/specs/web-ui.md` のノード ID 対応表も参照）。
- 状態一覧（通常 / 空 / 読み込み / エラー を基本に、画面固有の状態を追加）。
- 画面 ID は `docs/specs/ui-screens.md` の採番規則（`S-xx` / `D-xx` / `P-xx`）に合わせる。

## 4. API 契約

| メソッド | パス | リクエスト | レスポンス | エラー |
|---|---|---|---|---|
| | | | | |

- 正規化型・zod スキーマの置き場所（`packages/shared`）と型名を明記する。
- エラー形式は `docs/requirements.md` §10.3 の統一形式に従う。

## 5. データ変更（該当する場合。無ければ「なし」と明記）

- 追加・変更するテーブル / カラム（`packages/db`）。
- マイグレーション方針（後方互換か、破壊的変更かとその移行手順）。

## 6. 受け入れ条件

- [ ] AC-xx-1 ...
- [ ] AC-xx-2 ...

## 7. テスト観点

| 種別 | 内容 |
|---|---|
| unit | |
| 契約 / 統合 | |
| 手動 | |

## 8. 未決事項・要確認

`spec-change-guard` に従い、以下は本書では仮置きとし、決定後に `docs/requirements.md` を更新する。`【要確認】` は推測で実装しない。

| # | 事項 | 本書の仮置き | 選択肢 |
|---|---|---|---|
| | | | |

---

## 更新履歴

| 版 | 日付 | 内容 |
|---|---|---|
| v0.1 | YYYY-MM-DD | 初版 |
