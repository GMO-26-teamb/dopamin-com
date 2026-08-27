# 夜間バッチ レポート（2026-08-26 / ブランチ `sasaki/nightly-2026-08-26`）

レーン A / D / E の issue を指定順に 1 issue = 1 コミットで実装した。

## 最終結果

- **完了: 13 issue**（#54 は着手前に完了済み）
- **スキップ: 0 件**
- **`pnpm check`（Biome → typecheck → test）: グリーン**

```text
Tasks:    9 successful, 9 total
```

テスト件数（最終）: shared 489 / registry 168 / api 434（+ skip 28）/ web 494。

## 完了した issue

| # | 内容 | コミット |
|---|---|---|
| #54 | `requireOwnedDomain` の `forWrite` | `19341ae`（着手前に完了済み。差分確認のみ） |
| #56 | `transfers` 永続化・`GET /transfers`・`GET /transfers/:id` | `69a156c` |
| #57 | `POST /transfers/:id/{approve,reject,cancel}` | `f09b98a` |
| #58 | Poll 消化サービス・`POST /registry/poll`・`POST /domains/sync` | `f23fc7a` |
| #47 | 移管系 result code ごとの文言出し分け | `b4b0a77` |
| #59 | 移管 7 ケースの統合テスト（テスト DB 込み） | `d95e12e` |
| #53 | `GET /domains/:name` のレスポンス契約と移管バッジ | `58ccd51` |
| #60 | 参照系の自動再試行（最大 2 回・指数バックオフ） | `926c347` |
| #62 | `GET /health` に DB 接続結果と `specVersion` | `d4435cc` |
| #72 | コンタクト管理（`contacts` 再利用・PATCH の contacts） | `cf189bd` |
| #46 | mock アダプタの状態永続化 | `2fa8a35` |
| #48 | 契約テスト fixture の網羅 | `a3aeb06` |
| #49 | mock の `timeout_after_write` failMode | `00fc2e3` |
| #141 | エラーコード後方互換別名の削除 | `2ba879d` |

## 実装中に見つけて直した問題

レビュー（#56 / #57 で並列レビューエージェントを走らせた）と実装で見つかった、
**issue のスコープ外だが放置すると壊れるもの**を同じコミットに含めた。

1. **他ユーザーのドメインを奪う経路**（#56 / #57）。`transfers` の `pending` 行は
   拒否・取消では確定できず残り続ける。承認判定が「`info.lastTransferAt` が申請時刻以降」
   だけだと、後日その FQDN が無関係に移管された時点で死んだ行が承認扱いになり、
   `upsertDomainFromInfo` が `user_id` ごと上書きしてしまう。
   判定の窓を「申請時刻 〜 自動承認期限 + 猶予」に閉じ、取り込み・移管 OUT の反映前に
   所有者を確認するようにした。
2. **タイムアウトで誤った結果を確定させる**（#57）。`transferQuery` は申請が消えた理由を
   区別できないので、`reject` / `cancel` のタイムアウト照合は成立の証跡にならない。
   照合できるのは承認だけにし、他は 504 を返して Poll 消化に委ねた。
3. **移管 OUT 済みドメインの復活**（#57）。`GET /domains/:name` が `transferred_out` の行にも
   `info` を投げ、`upsertDomainFromInfo` が常に `owned` で書くため、部分一意インデックスを
   すり抜けて保有行が復活していた（AC-12-5 が壊れる）。#53 の「`transferred_out` は
   info を呼ばずキャッシュを返す」を前倒しで入れた。
4. **古い Poll 通知による移管の復活**（#58）。滞留した `transfer_request` 通知が、
   既に確定した移管を `pending` として作り直していた。反映前に `transferQuery` で
   申請がまだ残っているかを確かめるようにした。
5. **`DomainStore.list` が移管 OUT 済みを返していた**（#57）。AC-12-5 / AC-02-4 の
   「一覧から消える」の実体が無かったので、ストア側で `ownership = 'owned'` に絞った。

## issue の指示から意図的に外した点

いずれもコミットメッセージと `docs/specs/registry-api.md` に理由を書いてある。

- **#56**: スキーマ名を `transferStatusSchema` ではなく `transferRecordStatusSchema` にした。
  レジストリ正規化型の同名 export（`none` を含む）と `packages/shared` のバレル export で
  衝突するため。値域が正規化型の真部分集合という関係は保っている。
- **#47**: 文言表の実体を `packages/registry/src/errors.ts` ではなく
  `packages/shared/src/registry-codes.ts` に置いた。`@dopamin/registry` はアダプタ実装が
  `node:crypto` に依存していてブラウザから import できず、そこに置くと画面側
  （`apps/web/lib/error-messages.ts`）が同じ表を読めない。issue の目的
  （「表は 1 か所に集約」）を満たすには shared に置くしかない。TLD 表が同じ理由で
  shared にある前例に合わせ、registry からは re-export だけにした。
  結果として web 側にあった重複表（`REGISTRY_REJECT_REASON`）も消えている。
- **#53**: `domainDetailResponseSchema` に `displayStatus` と `transferEligibleAt` を
  **入れていない**。どちらもこの応答から一意に導出でき、`deriveDisplayStatus` /
  `transferEligibleAt`（`packages/shared`）が導出の SSOT になっている。API も計算済みの値を
  返すと 2 系統ができ、片方だけ直る事故になる（`domainSummarySchema` が表示ステータスを
  持たないのと同じ理由）。導出できない `pendingTransfer` は `summary.transfer` として返す。
- **#58**: `POST /domains/sync` の応答を `{ synced, failed }` に**改名していない**。
  既存の `{ domains, failures }`（`domainSyncResponseSchema`。web と FR-02 の AC が依存）
  を保ち、`pollProcessed` を足す拡張にした。
- **#46**: 状態の保存を行単位ではなくスナップショット単位にした。mock の 1 操作は
  複数ドメイン・複数キューをまたいで状態を変える（移管の確定は両当事者に通知を積む）ため、
  部分更新にすると整合を自前で組む必要がある。デモ用途の件数では単純さを採る方が正しい。
  同時実行は後勝ち。

## 申し送り

- **`contact:create` はタイムアウト照合の対象外**（#72 / #49）。作成した ID を引く手段が
  無いので `reconcileOnTimeout` に載せられない。初回の `POST /domains` がここで落ちると
  504 になり、再試行で別のコンタクトがレジストリ側に残る（実害は小さいが増える）。
  【要確認 §21.2】が解決して `contact:check` などで照合できるようになったら見直したい。
- **移管 IN で取り込んだドメインのコンタクト差し替えは未実装**（#72）。
  【要確認 §21.2 #14】が前提。
- **Poll 消化の失敗時は ack しない**（#58）。FIFO なのでキューはその 1 件で止まる。
  恒久的に処理できない通知が来た場合は手当てが要る（失敗は応答の `failures` と
  operation_logs に出る）。
- **#60 の再試行は poll.service 内の参照系には掛けていない**。issue が挙げた 4 か所
  （check / info / transferQuery / hello）に絞った。Poll 消化中の照会まで再試行すると
  1 回の消化のレイテンシが伸びるため、必要なら別途判断したい。
- `packages/db/drizzle/0006_wooden_scourge.sql`（`mock_registry_state`）は未適用。
  デプロイ前に `pnpm db:migrate` が要る。
