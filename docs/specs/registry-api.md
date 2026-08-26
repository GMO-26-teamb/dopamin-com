# spec: レジストリ連携 API（Bridge 層 + /domains・/transfers ルート）

| 項目 | 内容 |
|---|---|
| 対象 FR | FR-03（check）/ FR-06（create）/ FR-07（info）/ FR-08（renew）/ FR-09（update）/ FR-10（delete）/ FR-11（restore）/ FR-12（transfer）/ FR-18（エラー形式） |
| 優先度 | P0 |
| ブランチ | `feat/fr-06-registry-api` |
| 仕様の正 | `docs/registry/kitaqsign.openapi.json` / `kitaqnic.openapi.json`（2026-08-25 取得）+ `docs/registry/spec-notes.md` |

## 1. スコープ

- `packages/registry`: `RegistryAdapter` IF、kitaqsign / kitaqnic 実装（共通実装 `kitaq.ts`）、
  `mock` 実装（エラーシミュレーション付き）、TLD ルーティング、`RegistrySet` ファクトリ。
- `packages/shared`: 正規化型（`DomainInfo` / `TransferResult` / `PollMessage` 等）、
  zod スキーマ（ドメイン名・API 入出力・統一エラー）、
  操作可否の導出（`isOperationAllowed` / `isRestorable`）。
- `apps/api`: `/api/v1/domains` `/api/v1/transfers` ルート、requestId / errorHandler ミドルウェア、
  `/health` のレジストリ疎通表示。

### 非スコープ（後続タスク）

- ~~認証・セッション（FR-01）。現状の全ルートは認証なし~~ → 解決（2026-08-26、#50 / #129）:
  `/domains*` `/transfers*` は各ルーターの先頭 `.use(requireSession)`
  （`apps/api/src/middleware/session.ts`、環境型は `AuthedEnv`）で全ルート認証必須。
  未認証・無効セッションは 401 `UNAUTHORIZED`（AC-01-3）。`c.get("user")` でログインユーザーを参照する。
  所有権チェック（NFR-04。一覧側の AC-02-1 と同じ `user_id` 基準）は `/domains/:name*` の各ルートで
  `requireOwnedDomain(userId, name)`（`apps/api/src/services/domain.service.ts`）が行う:
  `domains` テーブル（FR-02 の DB キャッシュ）をドメイン名で引き、行が無ければ 404 `NOT_FOUND`
  （このアプリで保有していないドメイン）、行の `user_id` がログインユーザーと一致しなければ 403 `FORBIDDEN`。
  未対応 TLD の 400 `VALIDATION_ERROR`（`adapterForDomain`）が所有権より先に返る。
  `/transfers*` は `requireOwnedDomain` を使わない（#56）: 移管 IN は申請時点で `domains` 行が
  無い（§6.5）ため、ドメイン基準で見ると AC-12-1 の申請直後がすべて 404 になる。
  代わりに `GET /transfers/:id` と `POST /transfers/:id/{approve,reject,cancel}` が
  `transfers.user_id` を見る `requireOwnedTransfer`（`apps/api/src/services/transfer.service.ts`）で
  404 / 403 を返し分け、`GET /transfers` は `user_id` で行を絞る。`POST /transfers` は認証のみ。
  `POST /registry/poll` も認証必須だが、消化する通知はレジストラ単位なのでユーザーでは絞らない
  （反映先の行は通知のドメイン名から引く。上記 §3-16）。
- Poll 消化の定期実行（cron 等）。消化はユーザーのリクエスト起点（`GET /transfers` /
  `POST /domains/sync` / `POST /registry/poll`）だけで、誰も画面を開かない間は通知が溜まる。
  発表デモの範囲では十分だが、放置すると FIFO が伸びる。
- DB キャッシュ（FR-02 一覧・`domains` テーブル保存）、操作ログの永続化（FR-15）、
  独自性スコア（FR-05。check レスポンスの `uniqueness` は常に `null` のプレースホルダ）。

## 2. API 契約（実装済みルート）

| メソッド | パス | 実装 | 備考 |
|---|---|---|---|
| GET | `/health` | ✅ | 各レジストリの `hello` 疎通結果 + レイテンシを返す |
| POST | `/domains/sync` | ✅ | 保有ドメインを `info` で再同期し、**同時に Poll も消化する**（§10.1）。部分失敗は 200 + `failures[]`。`info` の clID が自レジストラでなければ `transferred_out` に倒して応答から外す（AC-02-4）。`pendingTransfer` を検知したら `transfers(out, pending)` を作る（Poll を取りこぼしても受信申請を拾えるようにする）。応答に `poll: { processed, failed }` を足した |
| POST | `/domains/check` | ✅ | `{sld, tlds[]}` or `{names[]}`。レジストリ単位で並列、部分失敗許容（AC-03-2） |
| POST | `/domains` | ✅ | check 再実行 → contact 作成 → create → info（AC-06 系）。authInfo はサーバー生成 |
| GET | `/domains/:name` | ✅ | `info` で最新化して DB キャッシュに write-through。レジストリに繋がらない（`REGISTRY_TIMEOUT` / `REGISTRY_UNAVAILABLE` / `REGISTRY_SPEC_MISMATCH`）ときは DB キャッシュを `stale: true` + `syncedAt` 付きで返す（AC-07-2、#129）。`NOT_FOUND` や拒否応答はそのまま返す |
| POST | `/domains/:name/renew` | ✅ | `{period}`。curExpDate は API 側で `info` から取得。10 年上限ガード（AC-08-2） |
| PATCH | `/domains/:name` | ✅ | `{nameservers?（全量指定→差分変換）, clientStatuses?{add,remove}}`。コンタクト変更は未対応 |
| DELETE | `/domains/:name` | ✅ | 削除ロック中 409（AC-10-2）。削除後の状態（RGP）を返す |
| POST | `/domains/:name/restore` | ✅ | `redemptionPeriod` 中のみ（AC-11-2） |
| POST | `/domains/:name/auth-code` | ✅ | `rotate-auth-info` を実行（取得のたびに authInfo が変わる）。再発行という副作用があるため GET ではなく POST（§10.2 の Origin 検証を通すため） |
| POST | `/transfers` | ✅ | `{name, authCode}` → transfer request → 202。受理を `transfers(direction=in, status=pending, requested_at, act_by_at, raw)` に記録し、`domains` 行は作らない（AC-12-1）。同じユーザー・同じドメインの pending 行があれば作り直さず更新する。応答は正規化 `TransferResult` から `raw` を除いた DTO（`transferResponseSchema`。ADR-0002）で、**一覧の `id` は返さない**（web が `id` にドメイン名を入れているフォールバックの解消は #57） |
| GET | `/transfers` | ✅ | ユーザーの `transfers` 行を `{ inbound, outbound, history }` で返す（`transfersListResponseSchema`）。`inbound` は進行中の移管 IN（`pending` と、承認済みで取り込み待ち = `domain_id` が null の `approved`）、`outbound` は受信した OUT 申請、`history` はそれ以外。**表示のたびにまず Poll を消化し**（§10.1。落ちても一覧は返す）、そのあと進行中の IN を `transferQuery` で照合して承認を検知したら取り込む |
| GET | `/transfers/:id` | ✅ | uuid（`transferIdParamSchema`）。一覧と同じ照合を 1 行だけ行う。非 uuid は 400、他人の行は 403、無ければ 404。取り込みの再試行に時間制限を掛けない点だけ一覧と違う（下記 §3-13） |
| POST | `/transfers/:id/approve` | ✅ | 受信した移管申請の承認（`direction = out` かつ `status = pending` の自行のみ）。`transferApprove` → `transfers` を `approved` + `completed_at`、`domains` を `ownership = transferred_out` + `transferred_out_at` に遷移（AC-12-4 / AC-12-5）。応答は `GET /transfers/:id` と同じ 1 件の要約 |
| POST | `/transfers/:id/reject` | ✅ | 受信した移管申請の拒否（同上の条件）。`transferReject` → `transfers` を `rejected`。保有は動かない |
| POST | `/transfers/:id/cancel` | ✅ | 自分が出した申請の取消（`direction = in` かつ `status = pending`、P1）。`transferCancel` → `transfers` を `cancelled` |
| POST | `/registry/poll` | ✅ | 全レジストリの Poll を消化して `transfers` / `domains` に反映する明示トリガー（デモ・検証用）。応答は `{ poll: { processed, failed } }`。通知はレジストラ単位なので、消化されるのはログインユーザーの分だけではない |

本 spec のルート（`/domains*` `/transfers*`）はすべて `requireSession` 必須（Cookie `dopamin_session`。requirements §10.1 の「認証: 要」に対応）。
統合テストは `apps/api/test/helpers/session.ts` の `installTestSession()` + `SESSION_COOKIE_HEADER`（DB 不要の seam）
または `createTestSession(db)`（pglite に実ユーザー行・セッション行を作る）で Cookie を付けて叩く（`docs/testing.md` §1）。

エラーは全ルートで統一形式（requirements.md §10.3）。`RegistryError` の変換は
`apps/api/src/middleware/error-handler.ts`、EPP result code → 正規化コードの対応は
`packages/registry/src/errors.ts`（2302→CONFLICT / 2303→NOT_FOUND / 2304→OPERATION_NOT_ALLOWED / 他 2xxx→REGISTRY_REJECTED）。

## 3. 設計判断（Swagger 精査で確定した事項）

1. **AuthCode は `rotate-auth-info` でのみ取得可**。`domain:info` の resData に authInfo は
   含まれない（両レジストリの Swagger で確認）。移管 OUT のたびに authInfo が変わる仕様として UI に明示する。
2. **restore は両レジストリとも 1 段階**（`POST /domains/{name}/restore`）。kitaqsign にも存在する
   （spec-notes の懸念は解消）。
3. **transfer query の専用エンドポイントは無い**（`op` enum に `query` はあるが paths に無い）。
   照会は `info` の `pendingTransfer` から導出する。approved / rejected / cancelled は区別できないため、
   状態遷移の検知は Poll 通知に寄せる（ADR-0002）。
4. **`renew` は `curExpDate`（YYYY-MM-DD）必須**。API は直前の `info` から取得して渡す。
5. **`domain:create` の registrant は既存コンタクト ID 必須**。アダプタの `create` が
   ダミー PII（レジストリの許可パターンに一致する固定値）でコンタクトを都度作成する。
   ユーザーごとのコンタクト再利用は DB 導入時（contacts テーブル）に移行する。
6. **RegistryAdapter に `hello()` を追加**（§11.1 の 8 操作 + transferQuery + authCode に加えて）。
   `/health` の疎通確認と TLD 一覧取得に使う。
7. タイムアウト: 参照系 5 秒 / 更新系 15 秒（`AbortSignal.timeout`）。更新系の自動再試行はしない（NFR-02）。
8. **`domain:update` の NS 追加はホストオブジェクトの事前作成が必須**（実測: 未作成は 2303）。
   アダプタの `ensureHosts` が `host:info` → 無ければ `host:create` で自動作成してから update を送る。
9. **`add.statuses`（ロックトグル）は実測でレジストリに反映されない**（成功応答のまま無視。
   spec-notes【要確認】10）。API はコマンドを送るが、運営確認まで UI 側のロックトグル実装は保留する。
10. **移管・Poll の正規化型は ADR-0002 に従う**。`TransferResult.status` は
    `pending / approved / rejected / cancelled / none` の 5 値（`none` は「移管中でない」）で、
    レジストリの生値は `registryStatus` に残す。レジストラ ID は `requestingRegistrarId` /
    `actingRegistrarId`（旧 `gainingRegistrar` / `losingRegistrar`）。`raw`（生応答）は
    正規化型には持つが API 境界で落とす（FR-18 / NFR-03）。`DomainInfo.sponsoringRegistrarId` は
    両 OpenAPI に clID が無いため当面 null。
    レジストリ差分: `reDate`（→ `requestedAt`）は kitaqnic のみ必須、`acDate`（→ `actByAt`）は
    kitaqnic のみ任意で kitaqsign は両方持たない。新有効期限の `exDate` は両方に無いため
    `newExpiresAt` は当面つねに undefined。
11. **`transfer/approve` `reject` `cancel` にはボディを送らない**（#43）。両レジストリの OpenAPI で
    `requestBody` を宣言しているのは `transfer/request` だけで、他 3 つには無い
    （`restore` / `rotate-auth-info` と同じ形）。`DomainTransferRequest.op` の enum には
    approve / reject / cancel があるため、実レジストリが必須ボディ欠落で拒否したときは
    `{ op }` を付けて `docs/registry/spec-notes.md`「移管フロー」を更新する。
    正規化ステータスの未知値は「呼んだ操作の結果」に倒す（approve なら `approved`）。
    生値は `registryStatus` に残すので情報は失われない。
12. **Poll / ack はエンドポイントだけがレジストリで違う**（#44）。kitaqsign は
    `GET /messages/poll` + `POST /messages/{id}/ack`、kitaqnic は `GET /messages` +
    `DELETE /messages/{id}`。応答の形（`PollResponse` / `PollMessageDto`）は完全に同一なので
    正規化は 1 本で済む。`msgType` の値域が未確定【要確認: §21.2 #13】なため、種別は
    **まず「移管通知か」を判定**する: `msgType` が `transfer` / `trn` を含む（EPP の Poll は
    `<domain:trnData>` で移管を伝える）か、payload が移管固有のフィールド
    （`gainingRegistrar` / `losingRegistrar` / `reDate` / `acDate`）を持つか。
    移管通知だと分かってから動詞（approve / reject / cancel / req）で分岐し、動詞が読めなければ
    `payload.status` に降り、それでも決まらなければ `'unknown'` に倒す（通知は捨てない）。
    `status` を先に見ないのは、部分一致の `matchTransferStatus` が無関係な通知の
    `pendingDelete` / `pendingRestore` を移管として拾ってしまうため。種別は消費側（#58）が
    `transfers` 行を作る根拠になるので、取りこぼし（`'unknown'` でも `domainName` /
    `registryStatus` / `raw` は残る）より捏造の方が高くつく。
    `payload` は `z.unknown()` で受けて後段で緩く読む（想定外の形で Poll ごと落とさないため）。
    `id` は int64 → string に正規化し、ack で URL に埋める直前に整数表記かを検証する
    （非整数は `REGISTRY_SPEC_MISMATCH`。ADR-0002 決定 8）。
13. **mock は相手レジストラを持つ**（#45）。`seedForeignDomain(name, authInfo)` で相手保有の
    ドメインを投入でき、`transferRequest` は**相手保有のドメインにしか出せない**
    （自保有への申請は暫定 2304。実レジストリの応答は【要確認: §21.2 #15】）。
    approve / reject は対応側、cancel は申請側だけが実行でき、役割違いは 2201。
    更新系（renew / update / delete / restore / rotate-auth-info）は現スポンサーのみ。
    自動承認は **`setTimeout` を使わず `info` / `transferQuery` / `poll` 時の遅延評価**で確定させる
    （Vercel Functions ではレスポンス後にタイマーが生き残らないため）。相手側の操作は
    `simulateInboundTransferRequest` / `simulateCounterpartApprove` / `simulateCounterpartReject`
    で起こす（レジストリ操作ではないので操作ログは出さない）。Poll 通知は「行為者以外の当事者」に積み、
    サーバ自動承認だけが双方に届く。設定は `MOCK_FOREIGN_REGISTRAR_ID` /
    `MOCK_TRANSFER_AUTO_APPROVE_MS`（§17）→ `RegistrySetConfig` 経由でアダプタへ。
14. **更新系タイムアウト時は再送せず参照系で結果を照合する**（AC-06-2 / AC-18-2）。
    `apps/api/src/lib/reconcile.ts` の `reconcileOnTimeout` が `REGISTRY_TIMEOUT` を捕捉し、
    `info`（transfer は `transferQuery`）で反映を確認できた場合のみ成功として返す
    （create=存在確認 / renew=期限延長 / update=要求変更の全反映 / delete=RGP 入りまたは消滅 /
    restore=RGP 離脱 / transfer=pendingTransfer）。確認できない場合は元の 504 を返す。
    `rotate-auth-info` は `info` で照合できない（authInfo が resData に含まれない）ため対象外。
13. **移管 IN の承認検知は `info` の `trDate` で行う**（#56）。`transferQuery` は
    `pendingTransfer` の有無しか見ないため、申請が消えた理由（承認 / 拒否 / 取消）を返せない
    （上記 3）。移管が成立したときだけレジストリが `trDate`（`DomainInfo.lastTransferAt`）を
    更新するので、**`pendingTransfer` が消え、かつ `trDate` が `transfers.requested_at` 以降
    `act_by_at` + 24 時間まで**なら承認とみなす。上限を付けるのは、この申請と無関係な後日の移管を
    自分の承認と取り違えないため（拒否・取消は検知できず行が `pending` のまま残るので、
    上限が無いと「拒否された数日後に第三者へ移管された」だけで他人のドメインを取り込む）。
    正規の承認は相手の approve かサーバの自動承認（申請 + 20 分）で起きるので、
    期限を大きく過ぎた `trDate` は自分の申請の結果ではない。
    判定できない場合（`trDate` を返さないレジストリ・拒否・取消・期限超過）は行を
    `pending` のまま据え置き、確定は Poll（#58）に委ねる。
    承認を検知したら §6.5 の順序どおり先に `status = approved` / `completed_at` を書き、
    そのあと `info` を `domains` に取り込んで `domain_id` を紐付ける。取り込みが失敗しても
    `approved` のまま残し、次回の `/transfers` 表示で再試行する。
    一覧からの自動再試行は「承認を検知した時刻」（`raw.checkedAt`）から 24 時間以内に限る
    （`domain_id` は ON DELETE SET NULL なので、廃止やデモリセットで `domains` 行が消えた行が
    毎回 `info` を叩き続けるのを防ぐ）。`completed_at` はレジストリの `trDate` なので基準に使わない
    （何日も前に成立していた移管を今日はじめて検知した行が、書いた瞬間に期限切れになるため）。
    再試行はまず DB の保有行を引いて紐付け直すだけで済ませ、行が無いときだけ `info` を叩く。
    ユーザーが明示的に叩く `GET /transfers/:id` はこの制限を掛けない。
    同名の保有行が**他ユーザーのもの**だった場合は取り込みを中止して `transfer_import_conflict`
    を warn ログに出す（承認は推定なので、推定を根拠に他人の保有行を奪わない。
    `transferred_out` への遷移は Poll 起点で #57 / #58）。
14. **`transferRequest` が受理を確認できないタイムアウトでも `transfers` 行を作る**（#56、ADR-0002 の宿題）。
    照合（上記 12）が `pending` を確認できなければ従来どおり 504 `REGISTRY_TIMEOUT` を返すが、
    `raw.reconcile = "timeout_unconfirmed"` の `pending` 行を残す。`transferQuery` は
    「申請が届いていない」と「届いたが既に完了した」を区別できないため、行が無いと後者を
    永久に取りこぼす。このとき `requested_at` にはレジストリの `reDate`（kitaqnic のみ）か、
    無ければ**申請を送り始めた時刻**を入れる。応答を待った時間だけ後ろにずれた「今」を使うと、
    待っている間に成立した移管の `trDate` が `requested_at` より前になり、
    行を作った目的である「届いたが既に完了した」を上記 13 で検知できなくなる。
    同じユーザー・同じドメインの `pending` 行への再申請は、`requested_at` / `act_by_at` を
    動かさず、`registry_status` / `counterpart_registrar_id` は判明した値だけ上書きする
    （実アダプタの `transferQuery` は `{ name, status, raw }` しか返さないため、
    そのまま当てると最初の申請で分かっていた値を null で潰してしまう）。到達していなかった場合はこの行が `pending` のまま残り、
    解消は Poll（#58）か取消（#57）になる。
    レジストリ受理後の DB 書き込み失敗はレジストリ操作の成否に影響させず、
    `transfer_row_write_failed` を error ログに出して 202 を返す（§6.5 の write-through）。

15. **Poll は「反映 → ack」を未 ack が無くなるまで繰り返す**（#58、`apps/api/src/services/poll.service.ts`）。
    `GET /messages` は最古の未 ack を 1 件返す FIFO で、ack するまで同じ通知が返る。
    消化点は `GET /transfers` / `POST /domains/sync` / `POST /registry/poll` の 3 つで、
    前 2 つは失敗しても本体の応答を返す（`consumePollSafely`）。
    1 リクエストあたりの上限はレジストリごと 50 件（`poll_budget_exhausted` を warn に出し、残りは次回）。
    **反映に失敗した通知は ack しない**: 反映できていない通知を消すと移管の事実が永久に失われるため、
    そのレジストリのキューはそこで止め（`poll_apply_failed`）、次回の消化で同じ通知から再開する。
    レジストリ間は並列・レジストリ内は直列で、1 つが落ちても他は消化を続ける。
16. **通知の宛先ユーザーはドメイン名から引く**（#58）。Poll はレジストラ単位で届き、
    通知にユーザーの情報は無い。`transfer_request` は `domains` の保有行から `user_id` を、
    完了通知（`transfer_approved` / `rejected` / `cancelled`）は同じドメインの `pending` 行から引く。
    向き（in / out）は `requestingRegistrarId` / `actingRegistrarId` と自レジストラ ID の比較
    （ADR-0002 決定 3）で決め、レジストラ ID を返さないレジストリでは「残っている pending 行の向き」に倒す。
    **どのユーザーにも紐付かない通知と未知種別（`unknown`）は ack して先へ進む**
    （`poll_message_unattributed` / `poll_message_unknown` を warn に出す）。1 件の孤児で
    以降の通知が全部読めなくなる方が実害が大きい。生の通知内容は `operation_logs`（`command = poll`）に残る。
17. **同じ通知の二度目は `UNIQUE(registry, registry_message_id)` で弾く**（#58）。
    ack に失敗すると同じ通知が再び返るため、反映前に通知 ID で既存行を引いて何もせず ack だけやり直す。
    申請の通知は行の作成時に、完了の通知は行を閉じるときに通知 ID を刻む。
    `info` の `pendingTransfer` から先に作られた「通知 ID を持たない `pending` の OUT 行」があれば、
    新規作成せずその行に通知 ID を刻む（registry-api.md v0.1 時点の宿題への回答）。
18. **移管 IN の承認が Poll と `info`（上記 13）の両方から来ても取り込みは 1 回**（#58）。
    一覧の照合が先に承認を検知して取り込み済みなら、あとから届く `transfer_approved` は
    `pending` 行が無いので何もしない（`poll_message_already_settled`）。
    このとき **`transferred_out` に倒してはいけない**（保有行は既に自分のもの）ので、
    向きが `in` と分かる通知は OUT の完了として扱わない。
    レジストラ ID を返さないレジストリでは向きが分からないため、`pending` 行が無い承認通知は
    **直近に `approved` の IN 行があれば「確定済みの IN」と読む**（申請の通知を取りこぼした
    OUT の完了と誤って読むと、取り込んだばかりの保有行を一覧から消してしまうため）。
    取りこぼした OUT は `POST /domains/sync` の clID 判定（上記 §2）で拾い直す。
19. **承認 / 拒否 / 取消のタイムアウトも `transferQuery` で照合する**（#57、上記 12 と同じ方針）。
    3 つとも成功すれば `pendingTransfer` が消えるので、照合で `pending` 以外が返れば反映済みとみなす。
    確認できなければ元の 504 を返す。`transfers` を閉じたあとの `domains` 遷移
    （`transferred_out`）が失敗した場合は 500 を返す: レジストリ側は既に手放しているので、
    握りつぶすと「レジストリでは他社のもの・アプリでは自分のもの」という不整合が残る。

## 4. テスト観点

- unit / contract: `docs/testing.md` §1（fixture は `docs/registry/fixtures/`）。
  実レジストリ経路（`kitaq.ts` / `http.ts`）は fetch スタブ + fixture を本番パース経路に通して検証する
  （`packages/registry/src/kitaq.test.ts` / `http.test.ts`。resData スキーマは `kitaq.ts` から export し
  `envelope.test.ts` と共有する）。
- 実レジストリ疎通: `apps/api/test/`（`pnpm --filter @dopamin/api test:connect`）。
  実行条件・副作用は `docs/testing.md` §2 を必読。

## 5. 未決事項

- ~~操作ログ（FR-15）~~: 実装済み。全レジストリ呼び出しを `operation_logs` へ永続化し
  構造化 console ログ（NFR-06）を出す。設計は [`docs/specs/operation-logs.md`](operation-logs.md)。
- ~~`GET /transfers/:name` は id 発番前の暫定パス~~ → 解消（#56）: `transfers` への永続化が入り、
  要件 §10.1 どおり `GET /transfers` / `GET /transfers/:id` になった。`GET /transfers/:name` は削除済み。
- 移管の照合が失敗した行（レジストリ障害・未対応 TLD）は一覧に `failures` として出さず、
  照合前の値のまま返して `transfer_reconcile_failed` を warn ログに出すだけにしている
  （`transfersListResponseSchema` を増やさない判断。1 件の失敗で一覧全体を 5xx にはしない）。
  1 リクエストで照合する行は 20 件が上限で、超過分は `transfer_reconcile_truncated` を出して DB の値のまま返す。
- `transfers` に「同じユーザー・同じドメインで pending の行は 1 件」という DB 制約は付けていない
  （重複防止はアプリ側の SELECT → INSERT / UPDATE。レジストリも `pendingTransfer` 中の再申請を 2304 で弾く）。
  Poll 由来の行（#58）は `UNIQUE(registry, registry_message_id)` で冪等になり、通知 ID を持たない
  `pending` の OUT 行は `(registry, domain_name, direction)` で突合して通知 ID を刻む（上記 §3-17）。
  実運用で重複が出るようなら部分一意インデックスの追加を再検討する。
- `POST /domains/check` の 1 リクエストあたりの件数上限がレジストリ側で不明（API 側は 20 件に制限）。
- コンタクト更新（FR-09 の一部）は未実装。移管 IN の取り込み後にコンタクトを自ユーザーの
  プロファイルへ差し替える処理（FR-12 /【要確認: §21.2 #14】）も未実装で、取り込んだドメインは
  相手レジストラ発行のコンタクト ID を参照したままになる。
- ~~`RegistryAdapter` の `poll` / `ackMessage`~~: 実装済み（#44）。§11.1 のメソッドは
  kitaq / mock ともすべて揃った。
- ~~アダプタの承認 / 拒否 / 取消と Poll 消化を叩く API ルート~~ → 解消（#57 / #58）:
  `POST /transfers/:id/{approve,reject,cancel}` と `POST /registry/poll` を実装し、
  `GET /transfers` / `POST /domains/sync` も Poll を消化するようになった（上記 §3-15〜19）。
- Poll の契約テスト fixture は `poll.kitaqsign.json` / `poll.kitaqnic.json` / `poll-empty.json`（#44）。
  `msgType` / `payload` と transfer fixture の `status` は実応答が未取得のため暫定値
  （`docs/registry/fixtures/README.md`）。
- Poll 通知の `msgType` の値と `payload` の中身は未確定【要確認: requirements.md §21.2 #13】。
- **web の HTTP 実装が未接続**（#57 / #58 は `apps/api` のみ）。`TransferService` の
  `list` / `refresh` / `approve` / `reject` / `cancel` は `notImplemented` のままで、
  `request` は移管一覧が無かった名残で `Transfer.id` にドメイン名を入れている
  （`apps/web/lib/api/http/http-services.ts`）。API のルートは揃ったので、繋ぐときに
  `GET /transfers` の `id`（uuid）へ寄せる（そのままだと `:id` が非 uuid で 400 になる）。
- `domainSummarySchema.transfer`（移管バッジ）は依然つねに null。#58 で `transfers(out)` の
  生産者は入ったが、`toDomainSummary` は `domains` の行しか見ないため、バッジを出すには
  一覧クエリに `transfers` の pending 行を結合する必要がある（詳細画面の「移管申請を受信」を
  API から出す作業とセットで別タスク）。それまで受信した申請は `GET /transfers` の `outbound` で見る。
