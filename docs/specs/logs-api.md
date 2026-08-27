# spec: ログ閲覧 API（操作ログ / AI ログ）

| 項目 | 内容 |
|---|---|
| 対象 FR / NFR | FR-14（AI ログ）/ FR-15（操作ログ）/ NFR-04（所有権）/ NFR-05（入力検証）。要件は `docs/requirements.md` §9.1 `operation_logs`・`ai_logs` / §10.1 `/logs/*` |
| 優先度 | P1 |
| 担当 | @takutaku |
| Issue | #64 |
| ブランチ | `sasaki/nightly-2026-08-27` |

---

## 0. ユーザーストーリー

- 利用者として、自分が行った操作（レジストリ通信）と AI 呼び出しを `/logs` 画面で新しい順に辿りたい。
  デモの場で「今なにが起きたか」を見せる導線であり、障害時の自己診断にも使う。
- 開発者として、件数が増えても一定コストで読めるページングが欲しい（offset だと後ろのページが重く、
  かつ書き込みが続くと行がずれる）。

## 1. 現状

- 記録側は実装済み。`apps/api/src/services/operation-log.service.ts`（#63）と
  `apps/api/src/services/ai-log.service.ts`（#65）が INSERT を持ち、
  `docs/specs/operation-logs.md` / `docs/specs/ai-logs.md` が設計を持つ。
  どちらの spec も「閲覧 API は #64」として本書に委ねている。
- 契約は `packages/shared/src/logs.ts`（#27）に揃っている:
  `paginationQuerySchema` / `pagedResponseSchema` / `operationLogItemSchema` / `aiLogItemSchema`。
- 読み出し側（`GET /logs/operations`・`GET /logs/ai`）は無かった。
- クエリ文字列の zod 検証ヘルパも無かった（`apps/api/src/lib/validator.ts` は JSON ボディのみ）。

## 2. 設計

```mermaid
flowchart LR
  C[apps/web /logs] -->|GET /logs/*?limit&cursor| R[routes/logs.ts]
  R -->|queryValidator paginationQuerySchema| S[services/log.service.ts]
  S -->|user_id で絞る / created_at DESC, id DESC / LIMIT n+1| DB[(operation_logs / ai_logs)]
  S -->|行 → 契約スキーマで検証| R
  R -->|{ items, nextCursor }| C
```

- **責務の境界**:
  - `packages/shared/src/logs.ts`: クエリと応答の契約（既存。本書では変更しない）
  - `apps/api/src/lib/validator.ts`: `queryValidator`（新規。失敗の形は `jsonValidator` と同じ §10.3）
  - `apps/api/src/services/log.service.ts`: カーソルの符号化・復号、絞り込み、行 → 契約への写像
  - `apps/api/src/routes/logs.ts`: 認証（`requireSession`）とサービス呼び出しだけ

### 2.1 カーソル

`created_at` は同着になり得る（同一 API リクエスト内の複数レジストリ呼び出しはミリ秒まで一致する）。
単独キーでページを刻むと、境界で行の重複・欠落が起きる。そこで `(created_at, id)` の複合カーソルにし、
`ORDER BY created_at DESC, id DESC` と揃える。

- 値は `"<ISO8601>|<uuid>"` を base64url にした不透明文字列。クライアントは中身を解釈しない。
- drizzle は行値比較（`(a, b) < (x, y)`）を組めないので、同着時のタイブレークを `OR` で展開する。
- 復元できない値は握りつぶさず `VALIDATION_ERROR`。先頭ページを返してしまうと
  「同じページが無限に返る」壊れ方になるため。

### 2.2 次ページの有無

`limit + 1` 件読み、余分の 1 件を捨てて `nextCursor` を「返した最後の行」から作る。
最終ページは `nextCursor: null`。ちょうど `limit` 件のときも次ページは無いので `null` になる。

### 2.3 行 → 契約への写像

`command` / `status` / `feature` などは値域を持つが DB 上は `text`。読み戻しでは契約スキーマで
`safeParse` し、通らない行はページ全体を 500 にせず、その行だけ落として `console.warn` する
（語彙を狭める変更のあとも過去ログのせいで一覧が壊れないようにする）。
`nextCursor` は「読んだ最後の行」から作るので、落とした行があってもページの継ぎ目はずれない。

`ai_logs` に `output_summary` 列は無い。保存するのは要約 + 構造化出力だけ（AC-14-2）という形に
合わせ、`outputSummary` は読み出し時に `summarizeForAiLog(output)` で作る。

## 3. 画面・UI

本書の範囲外（`/logs` 画面の接続は #90 / #93）。

## 4. API 契約

| メソッド | パス | リクエスト | レスポンス | エラー |
|---|---|---|---|---|
| GET | `/logs/operations` | `?limit=1..100`（既定 20）`&cursor=<opaque>` | `operationLogsResponseSchema`（`{ items, nextCursor }`） | 401 / 400（`limit` 範囲外・`cursor` 不正） |
| GET | `/logs/ai` | 同上 | `aiLogsResponseSchema` | 同上 |

- スキーマは `packages/shared/src/logs.ts`。型は `OperationLogsResponse` / `AiLogsResponse`。
- `request` / `response` はマスク済みの値をそのまま返す（AC-15-2。ここで再マスクはしない）。

## 5. データ変更

なし（`operation_logs` / `ai_logs` は #63 / #35 で作成済み。インデックスも
`(user_id, created_at)` が既にある）。

## 6. 受け入れ条件

- [x] 自分のログだけが新しい順に返る（他ユーザーと `user_id IS NULL` のシステム起点行は見えない。NFR-04）
- [x] `nextCursor` で辿ると重複も欠落もなく、最終ページで `null` になる
- [x] `created_at` が同着でも `id` のタイブレークで重複しない
- [x] `limit` の既定 20 / 上限 100。超過は `VALIDATION_ERROR`
- [x] 壊れた `cursor` は `VALIDATION_ERROR`（先頭ページにフォールバックしない）
- [x] AC-14-2: `outputSummary` は保存済み構造化出力から読み出し時に作る

## 7. テスト観点

| 種別 | 内容 |
|---|---|
| unit | カーソルの符号化 / 復号（`encodeLogCursor` / `decodeLogCursor`） |
| 契約 / 統合 | `apps/api/test/routes/logs.test.ts`: ページング境界（25 件を 10/10/5）、同着 `created_at`、他ユーザー不可視、`limit` 超過、壊れた cursor、契約外の行のスキップ |
| 手動 | `/logs` 画面接続後にスクロールで続きが読めること |

## 8. 未決事項・要確認

| # | 事項 | 本書の仮置き | 選択肢 |
|---|---|---|---|
| 1 | 期間・コマンドでの絞り込み | 持たない（新しい順の全件のみ） | クエリに `command` / `from` / `to` を足す / 画面側で絞る |

---

## 更新履歴

| 版 | 日付 | 内容 |
|---|---|---|
| v0.1 | 2026-08-27 | 初版（#64 の実装に合わせて起票） |
