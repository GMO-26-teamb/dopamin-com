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
| GET | `/domains/:name` | ✅ | `info` で最新化して DB キャッシュに write-through。レジストリに繋がらない（`REGISTRY_TIMEOUT` / `REGISTRY_UNAVAILABLE` / `REGISTRY_SPEC_MISMATCH`）ときは DB キャッシュを `stale: true` + `syncedAt` 付きで返す（AC-07-2、#129）。`NOT_FOUND` や拒否応答はそのまま返す |
| POST | `/domains/:name/renew` | ✅ | `{period}`。curExpDate は API 側で `info` から取得。10 年上限ガード（AC-08-2） |
| PATCH | `/domains/:name` | ✅ | `{nameservers?（全量指定→差分変換）, clientStatuses?{add,remove}}`。コンタクト変更は未対応 |
| DELETE | `/domains/:name` | ✅ | 削除ロック中 409（AC-10-2）。削除後の状態（RGP）を返す |
| POST | `/domains/:name/restore` | ✅ | `redemptionPeriod` 中のみ（AC-11-2） |
| POST | `/domains/:name/auth-code` | ✅ | `rotate-auth-info` を実行（取得のたびに authInfo が変わる）。再発行という副作用があるため GET ではなく POST（§10.2 の Origin 検証を通すため） |
| POST | `/transfers` | ✅ | `{name, authCode}` → transfer request → 202。応答は正規化 `TransferResult` から `raw` を除いた DTO（`transferResponseSchema`。ADR-0002） |
| GET | `/transfers/:name` | ✅ | **要件 §10.1 の `GET /transfers/:id` に対する暫定実装**（要件を変更するものではない）。`transfers` テーブルがまだ無く id を発番できないため、ドメイン名で `transferQuery`（`info` の `pendingTransfer` から導出）を返す。移管中でなければ `status: 'none'`、相手レジストラ ID は `info` から取れないため省略。DB には保存せず一覧化もしない。#56（transfers 永続化）で `GET /transfers/:id` に戻す |

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
12. **更新系タイムアウト時は再送せず参照系で結果を照合する**（AC-06-2 / AC-18-2）。
    `apps/api/src/lib/reconcile.ts` の `reconcileOnTimeout` が `REGISTRY_TIMEOUT` を捕捉し、
    `info`（transfer は `transferQuery`）で反映を確認できた場合のみ成功として返す
    （create=存在確認 / renew=期限延長 / update=要求変更の全反映 / delete=RGP 入りまたは消滅 /
    restore=RGP 離脱 / transfer=pendingTransfer）。確認できない場合は元の 504 を返す。
    `rotate-auth-info` は `info` で照合できない（authInfo が resData に含まれない）ため対象外。

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
- `GET /transfers/:name` は id 発番前の暫定パス。#56 で要件 §10.1 どおり `GET /transfers/:id` に戻す。
- `POST /domains/check` の 1 リクエストあたりの件数上限がレジストリ側で不明（API 側は 20 件に制限）。
- コンタクト更新（FR-09 の一部）と移管の承認 / 拒否（受け側・P2）は未実装。
- `RegistryAdapter` は §11.1 の `registrarId` / `transferApprove` / `transferReject` /
  `transferCancel` を実装済み（#43）。残りは `poll` / `ackMessage`（#44）で、
  `PollMessage` 型は `packages/shared` に用意済みだが生産者はまだ居ない。
  アダプタの承認 / 拒否 / 取消を叩く API ルート（`POST /transfers/:id/{approve,reject,cancel}`）は
  移管の永続化（#56）とセットで #57。
- Poll の契約テスト fixture は未整備（#44 / #48）。transfer fixture の `status` は
  実応答が未取得のため暫定値（`docs/registry/fixtures/README.md`）。
- Poll 通知の `msgType` の値と `payload` の中身は未確定【要確認: requirements.md §21.2 #13】。
