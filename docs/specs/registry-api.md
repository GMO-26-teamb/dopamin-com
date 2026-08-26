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
  `/transfers*` は移管の性質上、所有権は見ない（認証のみ）。
- DB キャッシュ（FR-02 一覧・`domains` テーブル保存）、操作ログの永続化（FR-15）、
  独自性スコア（FR-05。check レスポンスの `uniqueness` は常に `null` のプレースホルダ）。

## 2. API 契約（実装済みルート）

| メソッド | パス | 実装 | 備考 |
|---|---|---|---|
| GET | `/health` | ✅ | 各レジストリの `hello` 疎通結果 + レイテンシを返す |
| POST | `/domains/check` | ✅ | `{sld, tlds[]}` or `{names[]}`。レジストリ単位で並列、部分失敗許容（AC-03-2） |
| POST | `/domains` | ✅ | check 再実行 → contact 作成 → create → info（AC-06 系）。authInfo はサーバー生成 |
| POST | `/domains/sync` | ✅ | Poll を消化してから保有ドメイン（`ownership = 'owned'` のみ）を `info` で再同期する（#58）。`info` の `pendingTransfer` から受信中の申請を拾って `transfers(out)` を作り、`sponsoringRegistrarId` が自レジストラと違えば `transferred_out` に倒す（clID が取れるまで後者は効かない。【要確認 §21.2 #12】）。応答は `domainSyncWithPollResponseSchema`（`domains` / `failures` + `pollProcessed`）。順序が Poll → 同期なのは、先に消化しないと移管 OUT 済みの行がこの応答の保有一覧に残ってしまうため（AC-02-4） |
| GET | `/domains/:name` | ✅ | `info` で最新化して DB キャッシュに write-through。応答の契約は `domainDetailResponseSchema`（#53）。レジストリに繋がらない（`REGISTRY_TIMEOUT` / `REGISTRY_UNAVAILABLE` / `REGISTRY_SPEC_MISMATCH`）ときは DB キャッシュを `stale: true` + `syncedAt` + `error`（理由）付きで返す（AC-07-2、#129）。`NOT_FOUND` や拒否応答はそのまま返す。**`ownership = 'transferred_out'` の行はレジストリに問い合わせずキャッシュを返す**（#57。自レジストラが非スポンサーで `info` を信頼できず、`upsertDomainFromInfo` が常に `owned` で書くため部分一意インデックスをすり抜けて保有行が復活する） |
| POST | `/domains/:name/renew` | ✅ | `{period}`。curExpDate は API 側で `info` から取得。10 年上限ガード（AC-08-2） |
| PATCH | `/domains/:name` | ✅ | `{nameservers?（全量指定→差分変換）, clientStatuses?{add,remove}}`。コンタクト変更は未対応 |
| DELETE | `/domains/:name` | ✅ | 削除ロック中 409（AC-10-2）。削除後の状態（RGP）を返す |
| POST | `/domains/:name/restore` | ✅ | `redemptionPeriod` 中のみ（AC-11-2） |
| POST | `/domains/:name/auth-code` | ✅ | `rotate-auth-info` を実行（取得のたびに authInfo が変わる）。再発行という副作用があるため GET ではなく POST（§10.2 の Origin 検証を通すため） |
| POST | `/transfers` | ✅ | `{name, authCode}` → transfer request → 202。受理した申請は `transfers(direction = in, status = pending)` として永続化する（`domains` 行は作らない。AC-12-1）。応答は `{ transfer, record }`: `transfer` は正規化 `TransferResult` から `raw` を除いた DTO（`transferResponseSchema`。ADR-0002）、`record` は永続化した行の要約（`transferSummarySchema`。以降の `:id` 操作に使う） |
| GET | `/transfers` | ✅ | 移管一覧（`transfersListResponseSchema`）。`inbound`（IN 申請中）/ `outbound`（受信した OUT 申請）/ `history`（確定済み）に分けて返す。表示のたびに pending 行を `transferQuery` で照会して DB に反映する（#56。Poll 消化は #58 で足す） |
| GET | `/transfers/:id` | ✅ | 移管 1 件の状態照会（`id` は `transfers.id` の uuid。uuid 以外は 400）。承認を検知したら `info` で取り込み `domains` 行を作って `domain_id` を紐付ける（§6.5）。他ユーザーの行は 403（§10.3） |
| POST | `/transfers/:id/approve` | ✅ | 受信した OUT 申請を承認（`direction = out` かつ `status = pending` のみ、他は 409）。成功後 `domains.ownership = 'transferred_out'` にして保有一覧から外す（AC-12-5）。行は履歴として残す |
| POST | `/transfers/:id/reject` | ✅ | 受信した OUT 申請を拒否。保有は動かない（AC-12-4） |
| POST | `/transfers/:id/cancel` | ✅ | 自分の IN 申請を承認前に取消（`direction = in` のみ）。`domains` 行は元々無いので保有は動かない |
| POST | `/registry/poll` | ✅ | 全レジストリの Poll を未 ack が無くなるまで消化し `transfers` / `domains` に反映する（デモ・検証用の明示トリガー）。応答は `pollConsumeResultSchema`（`processed` / `created` / `settled` / `skipped` / `failures`）。キューはレジストラ単位でユーザーに分かれないため、反映先のユーザーは `domains` / `transfers` の行から引く |

本 spec のルート（`/domains*` `/transfers*`）はすべて `requireSession` 必須（Cookie `dopamin_session`。requirements §10.1 の「認証: 要」に対応）。
統合テストは `apps/api/test/helpers/session.ts` の `installTestSession()` + `SESSION_COOKIE_HEADER`（DB 不要の seam）
または `createTestSession(db)`（pglite に実ユーザー行・セッション行を作る）で Cookie を付けて叩く（`docs/testing.md` §1）。

エラーは全ルートで統一形式（requirements.md §10.3）。`RegistryError` の変換は
`apps/api/src/middleware/error-handler.ts`、EPP result code → 正規化コードの対応は
`packages/registry/src/errors.ts`（2302→CONFLICT / 2303→NOT_FOUND / 2304→OPERATION_NOT_ALLOWED / 他 2xxx→REGISTRY_REJECTED）。

result code ごとの**ユーザー向け理由文**は `packages/shared/src/registry-codes.ts` の
`userMessageForRegistryCode(code, command?)` が唯一の定義（#47）。API のエラー応答と
画面の Error Card（`apps/web/lib/error-messages.ts`）が同じ表を読む。
`packages/registry` からは re-export するだけで実体を持たない（アダプタ実装が
`node:crypto` に依存していてブラウザから import できないため。TLD 表と同じ扱い）。
`2202` / `2304` はコマンドで読み方が変わるので `RegistryError.command`（正準名）を見る。
画面側は command を持たないので移管文脈の文言に倒す。

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
15. **参照系だけを自動再試行する**（#60。§11.6 (e) / FR-18）。`apps/api/src/lib/retry.ts` の
    `withReadRetry` が `REGISTRY_TIMEOUT` / `REGISTRY_UNAVAILABLE` のときだけ
    最大 2 回、300ms → 600ms の指数バックオフで再試行する。適用先は
    `POST /domains/check` / `info`（詳細・sync）/ `transferQuery`（移管の照会）/ `hello`（/health）。
    `REGISTRY_REJECTED` / `NOT_FOUND` / `SPEC_MISMATCH` は「レジストリ側の事実」なので再試行しない。
    **更新系には適用しない**（NFR-02。応答が届かなくても成立していることがあり、再送は二重実行になる。
    そちらは `reconcileOnTimeout` が担当し、`confirm` の中の参照系も再試行しない
    ＝ 照合は 1 回きり）。Bridge 層ではなく API 層に置いたのは mock でも挙動を検証できるようにするため。
    再試行した分だけ `operation_logs` の行も増える（FR-15 は「全レジストリ呼び出し」を残す方針）。
16. **詳細レスポンスの契約は `packages/shared` が持ち、導出値は載せない**（#53）。
    `domainDetailResponseSchema`（`packages/shared/src/domains.ts`）が `GET /domains/:name` と
    更新系の応答形の SSOT で、`apps/web` も同じスキーマで検証する（旧: web 側に同じ形の
    別定義があった）。issue #53 が挙げていた `displayStatus` / `transferEligibleAt` は**入れない**:
    どちらもこの応答から一意に導出でき、`deriveDisplayStatus` / `transferEligibleAt`
    （`packages/shared`）が導出の SSOT。API も計算済みの値を返すと 2 系統になり、
    片方だけ直る事故になる（`domainSummarySchema` が表示ステータスを持たないのと同じ理由）。
    `pendingTransfer` は導出できないので `summary.transfer`（`{ direction, actByAt }`）として返す。
17. **照合できない操作はタイムアウトで確定させない**（#57）。移管の承認 / 拒否 / 取消のうち、
    `transferQuery` + `info` から成立を証明できるのは**承認だけ**（trDate が申請の窓の中で動く）。
    「`pendingTransfer` が消えた」は承認 / 拒否 / 取消・相手の取下げ・サーバ自動承認のどれでも起きるので、
    それを根拠に要求どおりの結果を書くと「拒否したのに移管されていた」「取り消したのに実は
    取得できていた（以後 `approved` にならないので取り込みも走らない）」を静かに作る。
    そこで `reject` / `cancel` は照合せず 504 を返し、確定は Poll 消化（#58）に委ねる。

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
- ~~`GET /transfers/:name` は id 発番前の暫定パス~~: 解消済み（#56）。`transfers` への永続化に伴い
  要件 §10.1 どおりの `GET /transfers` / `GET /transfers/:id` になった。
- 移管の確定検知は `transferQuery`（`info` の `pendingTransfer` 導出）だけでは
  承認 / 拒否 / 取消を区別できない（ADR-0002 決定 1）。#56 では **`info.lastTransferAt`（trDate）が
  申請時刻以降に動いていれば承認**という判定だけを行い（拒否・取消では trDate が動かないので偽陽性が無い）、
  拒否・取消の確定は Poll 消化（#58）に委ねて行を `pending` のまま残す。
- `POST /domains/check` の 1 リクエストあたりの件数上限がレジストリ側で不明（API 側は 20 件に制限）。
- コンタクト更新（FR-09 の一部）は未実装。移管の承認 / 拒否 / 取消（#57）と
  Poll 消化（#58）は実装済み。
- Poll 消化の失敗時は **ack しない**（`services/poll.service.ts`）。FIFO なのでキューは
  その 1 件で止まるが、ack して通知を失うと移管の状態を復元する手段が無くなるため。
  失敗は応答の `failures` と operation_logs（FR-15）に残り、次の消化で再試行される。
  1 回の消化で処理する上限は 50 件（異常時に関数の実行時間を使い切らないための保険）。
- ~~`RegistryAdapter` の `poll` / `ackMessage`~~: 実装済み（#44）。§11.1 のメソッドは
  kitaq / mock ともすべて揃った。アダプタの承認 / 拒否 / 取消と Poll 消化を叩く API ルート
  （`POST /transfers/:id/{approve,reject,cancel}` / `POST /registry/poll`）は
  移管の永続化（#56）とセットで #57 / #58。
- Poll の契約テスト fixture は `poll.kitaqsign.json` / `poll.kitaqnic.json` / `poll-empty.json`（#44）。
  `msgType` / `payload` と transfer fixture の `status` は実応答が未取得のため暫定値
  （`docs/registry/fixtures/README.md`）。
- Poll 通知の `msgType` の値と `payload` の中身は未確定【要確認: requirements.md §21.2 #13】。
