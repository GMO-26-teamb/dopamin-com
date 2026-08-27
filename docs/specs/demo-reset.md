# spec: デモデータリセット

| 項目 | 内容 |
|---|---|
| 対象 FR / NFR | FR-16（デモデータリセット）/ FR-12（移管）/ NFR-04（所有権）。要件は `docs/requirements.md` §10.1 `POST /demo/reset` / §11.1 / §3.3 |
| 優先度 | P1 |
| 担当 | @takutaku |
| Issue | #71 |
| ブランチ | `sasaki/nightly-2026-08-27` |

---

## 0. ユーザーストーリー

- 発表者として、デモの直前にボタン 1 つで自分のデータを既定の状態に戻したい。
  一覧に Active / RGP / 期限間近 / 移管中が並んでいれば、そのままデモシナリオ（§3.3 の 6〜8）を流せる。
- 運用者として、本番環境ではこの導線を出したくない。

## 1. 現状

- 応答の契約 `demoResetResponseSchema` は `packages/shared/src/ai.ts`（#27）にある。
- 有効フラグ `DEMO_RESET_ENABLED` は `apps/api/src/lib/env.ts`（#61）にあり、
  `GET /auth/me` の `features.demoReset` で配られている（AC-16-1 のクライアント側）。
- 投入処理・エンドポイントは無かった。
- mock アダプタには `seedForeignDomain` と `simulate*`（移管シミュレーション）があるが、
  自レジストラ保有のドメインを**任意の状態で**投入する口が無かった。

## 2. 設計

### 2.1 なぜ mock 固定か

FR-16 は「実登録するか mock に紐付けるか」を【要確認 §21.2 #7】として残している。
本書では **mock 固定**とする。

- 移管中の 2 件は 20 分でサーバ自動承認されるので、そもそも実レジストリでは維持できない（要件本文にも明記）。
- 実レジストリにテスト用ドメインを繰り返し登録・削除できるかが未確定。
- `REGISTRY_MODE=real` の環境では投入を**明示的に拒否**する（`OPERATION_NOT_ALLOWED`）。
  黙って実レジストリに `dopamin-demo-*` を登録しにいく方が危ない。

### 2.2 責務の境界

| 置き場所 | 持つもの |
|---|---|
| `packages/db/src/seed/demo.ts` | 命名（`dopamin-demo-<rand>-<scenario>`）、シナリオ定義、削除対象と `clearDemoData` |
| `packages/registry/src/mock.ts` | `seedOwnedDomain`（新規。自レジストラ保有を任意の状態で投入） |
| `apps/api/src/services/demo.service.ts` | mock への状態づくりと `domains` / `transfers` への取り込み |
| `apps/api/src/routes/demo.ts` | 有効フラグの判定と認証 |

投入の choreography を `apps/api` に置くのは 2 つの理由による。
レジストリ固有の処理を `packages/registry` の外に出さない（CLAUDE.md / NFR-07）ため、
そして行の写像（`toDomainValues`）や移管の記録（`recordInboundTransferRequest` /
`recordOutboundTransferRequest`）を二重に持たないため。
`packages/db` はレジストリにも `@dopamin/shared` にも依存しないまま保つ。

### 2.3 `seedOwnedDomain` を足した理由

`create` は「今つくったドメイン」しか作れない（`exDate` は必ず登録時 + 期間、
`rgpStatuses` は `addPeriod` 固定）。FR-16 が要求する「期限間近」「RGP 中」という
**途中の状態**は再現できず、実レジストリにも同じことは頼めない。
そこで mock 側のシミュレーション API として持つ（`seedForeignDomain` と同じ位置づけ。
レジストリ操作ではないので操作ログは発行しない）。

同期 API なので自動では永続化されない。ストアを使う構成（#46）では続く `info` が
`hydrate()` で DB から状態を読み直すため、**書き戻す前に呼ぶと投入したドメインが消える**。
各シードの直後に `persist()` を挟む。

### 2.4 投入する 5 件

| シナリオ | 作り方 | 確認できること |
|---|---|---|
| `active` | `seedOwnedDomain`（登録 90 日前・NS あり） | 詳細・サブドメイン設計の出発点 |
| `rgp` | `seedOwnedDomain`（`redemptionPeriod` + `pendingDelete`）+ `rgp_until` | 復旧ボタン（FR-11）と残日数 |
| `expiring` | `seedOwnedDomain`（登録 345 日前 = 期限 20 日後） | 期限警告と更新（FR-08） |
| `transfer-in` | `seedForeignDomain` → `transferRequest` → `recordInboundTransferRequest` | 移管 IN 申請中（AC-12-1） |
| `transfer-out` | `seedOwnedDomain` → `simulateInboundTransferRequest` → `recordOutboundTransferRequest` | 受信した OUT 申請の承認 / 拒否（AC-12-4） |

移管 IN は `domains` 行を作らない（§6.5）ので、保有一覧は 4 件・`transfers` は 2 件になる。

`rgp_until` は両レジストリの `info` が返さないため通常経路では書かれない。デモでは
「残日数つきの RGP バッジ」を見せたいので、§11.4 の目安（Redemption GP 30 日）を
`setDomainRgpUntil` で直接入れる。この関数は `DomainStore` の口にはしない
（インメモリ実装が `rgpUntil` を持たず、デモ以外に使い道が無いため）。

### 2.5 削除の範囲

消す対象は `domains`（+ CASCADE で落ちる `subdomain_plans` / `dns_records`）・`transfers`・
`operation_logs`・`ai_logs` の 4 つで、いずれも同じトランザクションで消す。

`domains` を消せば `subdomain_plans` / `dns_records` は FK の `ON DELETE CASCADE` で落ちる。
`transfers.domain_id` は `ON DELETE SET NULL` で行が残るので `user_id` で明示的に消す。
`operation_logs.user_id` は `ON DELETE SET NULL`（退会後も恒久保存）だが、デモリセットは
「この画面をきれいにする」操作なので本人の行は消す。他ユーザーの行には触れない。
`ai_logs.user_id` は `ON DELETE CASCADE`（退会時に一緒に落ちる）なので、`domains` を消すだけでは
残る。デモリセットは退会ではないため、本人の行を明示的に消す（FR-14 の AI ログも消える）。
`docs/specs/ai-logs.md` §8 #5 の「無期限（削除しない）」は TTL / アーカイブの話で、
本人操作によるリセットはその例外。

リセットは何度も押されるので、DB を消す前に前回のデモ用ドメイン名を控え、
mock からも削除する（best-effort。失敗しても DB のリセットは成立させる）。

## 3. 画面・UI

本書の範囲外（設定画面のリセット UI は #94。`features.demoReset` が false のときはボタンを出さない）。

## 4. API 契約

| メソッド | パス | リクエスト | レスポンス | エラー |
|---|---|---|---|---|
| POST | `/demo/reset` | — | `demoResetResponseSchema`（`{ ok: true, domains: string[] }`） | 401 / 404（`DEMO_RESET_ENABLED` が true でない）/ 409（`REGISTRY_MODE=real`） |

無効な環境で 403 ではなく **404** を返すのは、エンドポイントの存在自体を伝えないため。

## 5. データ変更

なし（既存テーブルへの投入と削除のみ）。

## 6. 受け入れ条件

- [x] AC-16-1: `DEMO_RESET_ENABLED=true` の環境でのみ実行できる
- [x] AC-16-2: リセット後にデモシナリオ（§3.3 の 6〜8）を再現できる状態が揃う
- [x] 他ユーザーのデータには影響しない（NFR-04）
- [x] 連続で実行できる（前回のデモ用ドメインを mock から掃除する）

## 7. テスト観点

| 種別 | 内容 |
|---|---|
| unit | `packages/registry/src/mock.test.ts`: `seedOwnedDomain`（保有・期限・RGP・inactive・重複・ログ非発行） |
| 契約 / 統合 | `apps/api/test/routes/demo.test.ts`: 5 件の投入と各状態、移管 IN / OUT が 1 件ずつ pending、既存データの削除、他ユーザー不可視、連続実行、`DEMO_RESET_ENABLED` 未設定 / false で 404、`REGISTRY_MODE=real` で 409 |
| 手動 | リセット後に一覧・詳細・移管画面がデモシナリオどおりに見えること |

## 8. 未決事項・要確認

| # | 事項 | 本書の仮置き | 選択肢 |
|---|---|---|---|
| 1 | 【要確認 §21.2 #7】実レジストリへのデモ用ドメインの実登録 | 行わない（mock 固定） | レジストリ側の削除・再利用制約が確認できたら `active` / `expiring` だけ実登録に寄せる |
| 2 | デモ用ドメインにサブドメイン設計（FR-13）を投入するか | 投入しない（設計は空の状態から始める） | `active` に設計 + 反映済みレコードを入れて FR-13 の完成形も見せる |

---

## 更新履歴

| 版 | 日付 | 内容 |
|---|---|---|
| v0.1 | 2026-08-27 | 初版（#71 の実装に合わせて起票） |
| v0.1.1 | 2026-08-27 | 実装との乖離を修正。§2.5 の削除対象に `ai_logs`（`clearDemoData` が同じトランザクションで本人の行を消す）を追記 |
