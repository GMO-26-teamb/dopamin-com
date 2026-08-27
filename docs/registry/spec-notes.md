# レジストリ仕様メモ（EPP-over-REST）

出典: 各レジストリの Swagger UI（`/v3/api-docs`）。**Swagger が仕様の正**であり、本メモは差分の要約。
齟齬があれば Swagger を優先し、本メモを更新する。

- Kitaqsign: <https://docs.kitaqsign.com/swagger-ui/index.html> — `registry-kitaqsign EPP-over-REST API (対応 TLD: .com .net .org .info)` v1 / OAS 3.0
- Kitaqnic: <https://docs.kitaqnic.com/swagger-ui/index.html> — `registry-kitaqnic EPP-over-REST API (18 gTLD)` v1 / OAS 3.0
- 取得日: 2026-08-25
- **2026-08-27 の仕様変更**: `.org` / `.info` の管轄が kitaqsign → kitaqnic へ移管（kitaqsign は `.com` `.net` の 2 種、kitaqnic は 20 種に）。上の Swagger タイトルは 8/25 取得時点のもの。詳細は [`kitaqsign/CHANGELOG.md`](kitaqsign/CHANGELOG.md) / [`kitaqnic/CHANGELOG.md`](kitaqnic/CHANGELOG.md)
- OpenAPI 定義の実物（`/v3/api-docs`、Basic ゲート認証付きで取得）: [`kitaqsign.openapi.json`](kitaqsign.openapi.json) / [`kitaqnic.openapi.json`](kitaqnic.openapi.json)
- 仕様変更の記録先（requirements §11.5 の手順 1）: [`kitaqsign/CHANGELOG.md`](kitaqsign/CHANGELOG.md) / [`kitaqnic/CHANGELOG.md`](kitaqnic/CHANGELOG.md)
- 契約テストの fixture: [`fixtures/README.md`](fixtures/README.md)

RFC 5730–5733 の EPP をトランスポートだけ HTTP/REST + JSON に置き換えた擬似レジストリ（ハッカソン教材）。
コマンド体系と result code の意味論は本物準拠。

## 1. 共通仕様（両レジストリで同一）

### オリジンとベースパス

| | 値 |
|---|---|
| API オリジン | `https://epp.kitaqsign.com` / `https://epp.kitaqnic.com` |
| ベースパス | `/api/v1/epp` |
| RDAP | `rdap.` サブドメインの `/rdap/v1/domain/{name}`。WHOIS は提供されない |

`docs.*` は Swagger UI のホストであって API のホストではない。

### 認証（2 段。両レジストリで方式は同一）

1. **共通 Basic ゲート** — HTTP Basic（レジストリ側の `ADMIN_GATE_USER` / `ADMIN_GATE_PASSWORD`）。全エンドポイントに必要。
2. **レジストラ API キー** — `X-Registrar-Id`（例 `KITAQ-TEST-001`）+ `X-Api-Key`（平文）。

- 例外: `GET /sessions/hello` は API キー不要（Basic ゲートのみ）。疎通確認に使う。
- `session:login` / `logout` は**任意**。リクエスト毎に認証するステートレス実装のため、呼ばなくても各コマンドを実行できる。
- 環境変数は `apps/api/.env.example` の `KITAQSIGN_*` / `KITAQNIC_*` を参照（1 レジストリあたり gate user / gate password / registrar id / api key の 4 つ）。

### clTRID（トレース ID）

任意ヘッダ `X-Cl-TRID` に**毎回ユニークな値**を付ける（64 文字以内推奨・形式自由・一意性は強制されない）。
レスポンスの `trID.clTRID` にエコーされ、`trID.svTRID` がサーバ採番。障害調査時のキーになるため両方 `operation_logs` に残す。
ヘッダ名は大文字小文字を区別しない。

### レスポンスエンベロープ

```json
{
  "result": { "code": 1000, "msg": "Command completed successfully" },
  "resData": { "...": "コマンドごとの結果" },
  "extension": { "...": "レジストリ固有（kitaqnic の launch 等）" },
  "trID": { "clTRID": "ABC-12345", "svTRID": "KQSGN-20260505-0001" }
}
```

> ⚠️ **実測との差異**: Swagger 本文の例は `"msg"` だが、実際のレスポンスは `"message"` を返す（両レジストリとも `hello` で確認）。zod スキーマは `message` を必須にし、`msg` は受けない。

エラー時は `resData` / `extension` が省略され、`result` に `reason` / `extValue` が付く（実測）:

```json
{
  "result": { "code": 2303, "message": "Object does not exist",
              "reason": "example.com not found", "extValue": null },
  "trID": { "clTRID": "AUTHCHECK-...", "svTRID": "KQSGN-20260825-000037" }
}
```

`reason` は人間向けの詳細メッセージ。`operation_logs` に残すが UI にはそのまま出さない（正規化エラーに変換する）。

**成否は 2 段で判定する。** HTTP ステータス（トランスポート層）と `result.code`（業務結果）の両方を見る。
HTTP 200 でも `result.code` が 2xxx なら失敗。アダプタはこの 2 段判定を行ってから正規化型に変換する。

| result.code | 意味 | HTTP 対応（観測例） |
|---|---|---|
| 1000 | 成功 | 200 |
| 2202 | authInfo 不一致 | — |
| 2302 | 既に存在 | 409 ObjectExists |
| 2303 | 存在しない | 404 ObjectNotFound |
| 2306 | ポリシー違反 | — |

### 値の制約（違反は 400）

| 項目 | 制約 |
|---|---|
| コンタクト ID | 3〜16 文字。英数字とハイフン。先頭ハイフン不可。レジストラ内で一意 |
| ドメイン名 | 全体 253 文字 / 各ラベル 63 文字。英数字とハイフン。ラベル先頭・末尾ハイフン不可 |
| ホスト名 | 最大 255 文字。FQDN 形式 |
| authInfo | 1〜64 文字（超過は 400）。RFC 9154 は 128bit 以上のエントロピー推奨 |
| 氏名 | **許可されたダミー氏名のみ** — John Doe / Jane Doe / Taro Test / Hanako Test / Test User / Demo User / Sample Person / Example Contact |
| メール | **予約ドメインのみ** — `@example.com` / `@example.net` / `@example.org` |

氏名・メールの制約は要件の PII 方針（実在個人情報を登録しない）と一致する。バリデーションは `packages/shared` の zod スキーマ側でも掛け、レジストリに届く前に落とす。

### 依存関係と実行順序

```
contact（登録者・各ロール）─┐
                            ├─▶ domain
host（ネームサーバ）────────┘
```

`domain:create` の `registrant` / `contacts` は**既存のコンタクト ID** を指す必要がある（存在チェックあり、無ければ 404）。
`nameservers` はホスト名の文字列で、ホストオブジェクトの事前作成は推奨だが必須チェックはされない。

### domain:update の実測制約（2026-08-25・両レジストリで確認）

- **`add.nameservers` はホストオブジェクトの事前作成が必須**（create と異なり存在チェックされる）。
  未作成のホストを指定すると 2303 / reason `"<host> not found"`。`POST /hosts`（`{name, addrs?}`）で
  作成すれば通る。対象 TLD 外のホスト名（kitaqnic に `*.example.net` 等）の作成可否は未検証のため、
  アダプタ（`packages/registry` の `ensureHosts`）が参照前に info → create で自動作成する。
- ドメイン配下のホスト（`ns1.<domain>`）を NS に設定していても `domain:delete` は成功する（実測）。
- **`add.statuses` / `rem.statuses` は 2026-08-27 の運営修正で反映されるようになった**（§3 #10 で解決）。
  2026-08-25 時点では result 1000 を返すのに `domain:info` の status が変わらなかった（clientHold /
  clientTransferProhibited / clientDeleteProhibited で確認）。kitaqnic は実測で修正を確認済み、
  kitaqsign はメンテナンス中で未実測。経緯は [`kitaqnic/CHANGELOG.md`](kitaqnic/CHANGELOG.md) /
  [`kitaqsign/CHANGELOG.md`](kitaqsign/CHANGELOG.md)。
- リクエストボディの未知フィールドは 400 / 2001 `Malformed JSON` で拒否される（厳格パース）。

### 非同期通知（Poll）

Poll は**常に最古の未 ack メッセージを 1 件**返す FIFO（未 ack 件数も返る）。
エンドポイントだけはレジストリで異なる（§2 の差分表）。
**ack するまで同じメッセージが返り続け、新しい通知を受け取れない。** 自動失効なし。
移管の承認/拒否は専用 API で行うため、ack は業務処理をブロックしない（消し込み専用）。

**移管通知の実測（kitaqnic 2026-08-27、#176。kitaqsign はメンテナンス中で未実測）**:

```json
{
  "resData": {
    "count": 1,
    "message": {
      "id": 522,
      "msgType": "domain:transfer",
      "payload": { "op": "reject", "domain": "dopamin-trf-mtayaan3.xyz", "counterpartyRegistrar": "teamb" },
      "qdate": "2026-08-27T12:16:52.607727"
    }
  }
}
```

- `msgType` は `"domain:transfer"` 固定、動詞は `payload.op`。相手レジストラは
  `counterpartyRegistrar`（受信者から見た相手）1 個だけで、gaining / losing の区別や日時は載らない。
- 宛先: `request` は losing に、`approve` / `reject` は gaining に積まれる。
- アダプタ（`packages/registry` の `toPollMessage`）は `op` → 種別、`counterpartyRegistrar` →
  requesting（request / cancel）/ acting（approve / reject）に写す。詳細は §3 要確認 #12 の解決記録。

### 自動更新（Auto-Renew）

exDate 超過でも廃止されず、レジストリが自動で 1 年延長（毎分のバッチ）。
直後から 45 日間 RGP の `autoRenewPeriod` が付く（`domain:info` の `rgpStatus` / RDAP の status で確認）。
**Poll 通知は積まれない**ため、レジストラ側は `exDate` / `rgpStatus` の照会で把握する。
対象は `pendingDelete` / `pendingTransfer` 等にないドメインのみ（`clientHold` は自動更新される）。

### 移管フロー

1. gaining（移管先）が `POST /domains/{name}/transfer/request` に authInfo を付けて申請 → `pendingTransfer`、losing 側に Poll 通知
2. losing が `approve` / `reject`
3. gaining は承認前なら `cancel` 可能

- **losing が放置すると申請から 20 分後にサーバが自動承認**（本来は 5 日。ハッカソン用に短縮）
- ICANN の「登録後 60 日以内は移管拒否可」はレジストラ側ルールのため、本ハッカソンでは対応不要（登録直後でも移管できる）
- **`requestBody` を宣言しているのは `transfer/request` だけ**（`DomainTransferRequest {op, authInfo?, period?}`）。
  `approve` / `reject` / `cancel` の 3 つは両 openapi.json とも `requestBody` を持たないため、
  アダプタ（`packages/registry` の `transferAct`）は `restore` / `rotate-auth-info` と同じくボディを送らない。
  実レジストリが必須ボディ欠落や 400 / 2001 で拒否するようなら `{ op }` を付け、本メモを更新する。
- 応答はいずれも `EppResponseDomainTransferResponse`（request と同じ形）。`request` だけ HTTP 202、
  `approve` / `reject` / `cancel` は 200。拒否は 403（操作権限なし）/ 409（転送リクエスト不在）

### ドメインステータス（RFC 5731）

`ok` は他ステータスと排他（保留・制限・pending があると付かない）。
`inactive`（NS 未設定）/ `pendingTransfer` / `pendingDelete` / `clientHold`（名前解決停止）/ `clientTransferProhibited` / `clientUpdateProhibited` / `clientDeleteProhibited` / `clientRenewProhibited`。
`client*` はレジストラが `domain:update` で設定、`server*` はレジストリが設定。

## 2. レジストリ差分（アダプタで吸収する箇所）

| 項目 | kitaqsign | kitaqnic |
|---|---|---|
| 対応 TLD | `.com` `.net`（2。8/27 に `.org` / `.info` は kitaqnic へ移管） | `.org` `.info` `.xyz` `.online` `.site` `.tech` `.space` `.store` `.website` `.press` `.host` `.fun` `.icu` `.cyou` `.sbs` `.bond` `.cfd` `.art` `.build` `.ceo`（20）**重複なし** |
| `domain:restore` | `POST /domains/{name}/restore` **あり**（openapi.json で確認。1 段階） | `POST /domains/{name}/restore` あり（1 段階） |
| `rotate-auth-info` | `POST /domains/{name}/rotate-auth-info` あり | あり（「kitaqnic 拡張」と表記） |
| launch 拡張 | なし | `LaunchApplicationRequest` / `LaunchApplicationResult` スキーマあり |
| `domain:info` の型 | `DomainResponse` / `EppResponseDomainResponse` | `DomainInfoResponse` / `EppResponseDomainInfoResponse` |
| `domain:update`（PUT）の応答 | `EppResponseDomainResponse`（更新後のドメイン情報が返る） | `EppResponseUnit`（**空**。更新後の情報は `info` で取り直す） |
| poll / ack | `GET /messages/poll` + `POST /messages/{id}/ack` | `GET /messages` + `DELETE /messages/{id}` |
| Poll のタグ名 | `Message` | `Messages` |
| svTRID プレフィクス | `KQSGN-` | `KQNIC-` |
| `hello` の TLD フィールド | `resData.tlds` | `resData.info.supportedTlds` |
| `DomainTransferResponse` | `domain` / `status` / `gainingRegistrar` / `losingRegistrar` | + `reDate`（必須）/ `acDate`（任意）。`exDate` は**両方に無い** |
| `hello` の形状 | `resData` に `registryCode` / `tlds` / `message` | `resData` に `svID` / `svDate` / `svcMenu` / `info`（EPP greeting に近い） |
| 宣言 extension | なし | `premium` / `launch` / `fee` |

**認証・エンベロープ・result code・値の制約・移管フロー・Auto-Renew は両者で同一。**
差分の大半は「対応 TLD」「一部エンドポイントの有無とメソッド」「レスポンス型名」に収まる。
唯一のフィールドレベルの差が `DomainTransferResponse` の `reDate` / `acDate` で、これが
`TransferResult.requestedAt` / `actByAt` を optional にする理由になっている（ADR-0002）。

## 3. 【要確認】

実装前に潰す。判明したら本メモと `docs/requirements.md` を更新する。

1. ~~kitaqnic の対応 18 gTLD の内訳~~ → **解決**（§2 の表・`hello` で取得済み）
2. ~~TLD ルーティングの衝突~~ → **解決**。重複なし。TLD からレジストリが一意に決まる
3. ~~`.jp` の扱い~~ → **解決**。両レジストリとも非対応。デモシナリオの `.jp` を差し替える必要あり
4. ~~`authCode` の取得方法~~ → **解決**（openapi.json で確認）。`domain:info` の resData に authInfo は
   **含まれない**。`POST /domains/{name}/rotate-auth-info`（再生成）が唯一の手段
   （レスポンスは `EppResponseMapStringString`、resData に `authInfo`）。
   **移管 OUT のたびに authInfo が変わる**仕様として UI に明示する。
5. ~~kitaqsign の `restore` の有無~~ → **解決**。kitaqsign にも `POST /domains/{name}/restore` が**ある**
   （openapi.json の paths で確認）。両レジストリとも **1 段階**（request/report の 2 段階ではない）。
6. ~~kitaqsign の poll ack のメソッド~~ → **解決**。kitaqsign は `GET /messages/poll` + `POST /messages/{id}/ack`、
   kitaqnic は `GET /messages` + `DELETE /messages/{id}`（アダプタで吸収する）。
7. **Basic ゲートの認証情報が両レジストリで共通か** — 共通なら env を 1 組に寄せられる。
8. **`domain:check` の 1 リクエストあたりの上限件数** — 形式は `DomainNamesRequest`（`{names: []}`）で確定。
   上限は Swagger に記載なし（アプリ側は 20 件に制限して運用）。
9. **レジストラ ID はチームごとに別か** — 別でなければ他チームとの移管は同一レジストラ内の操作になり成立しない。
   テスト用の第 2 レジストラ資格情報が出るかも併せて確認（requirements §21.2 #11）。
10. ~~`domain:update` の `add.statuses` が反映されない~~ → **解決**（運営が 2026-08-27 に修正をアナウンス。
    kitaqnic 実測 8/27 で確認）: `add.statuses: ["clientTransferProhibited"]` が `domain:info` に反映され、
    ロック中の `transfer/request` は **result 2304**（Object status prohibits operation）で拒否される。
    `rem.statuses` で解除も動く。FR-09 の「ロック」トグルは動作可能になった。kitaqsign はメンテナンス中で未実測。
11. ~~非スポンサーからの `domain:info` の応答~~ → **解決**（kitaqnic 実測 8/27、#176 検証）: 拒否されず
    **成功し、全ステータスが見える**。`clID`（現スポンサー）は引き続き含まれない。
    そのため移管 OUT 完了の検知は Poll の承認通知が主のまま（§21.2 #12）。kitaqsign 未実測。
12. ~~Poll 通知の種別と中身~~ → **解決**（kitaqnic 実測 8/27、#176。kitaqsign はメンテナンス中で未実測）:
    `msgType` は **`"domain:transfer"` 固定**で、動詞は `payload.op`（`request` / `approve` / `reject`。
    `cancel` は op の enum から推定・未実測）。`payload` は
    `{ op, domain, counterpartyRegistrar }` の 3 フィールドのみ（`counterpartyRegistrar` は**受信者から
    見た相手** 1 個。Swagger 推測にあった `status` / `gainingRegistrar` / `losingRegistrar` / `reDate` /
    `acDate` は来ない）。`qdate` はタイムゾーン無しのマイクロ秒精度（例 `2026-08-27T12:16:52.607727`）。
    宛先の実測: `request` は losing に、`approve` / `reject` は gaining に積まれる。
    形そのものは openapi.json どおり
    `PollResponse { count, message? }` / `PollMessageDto { id: int64, msgType, payload, qdate }`。
    正規化型（`PollMessage.type`）は独自語彙のまま、対応づけられない通知は `unknown` に倒す（ADR-0002）。
13. **移管時のコンタクトの扱い** — 相手レジストラ発行のコンタクト ID を参照したまま `domain:update` できるか、
    自コンタクトへの差し替えが必須か。非スポンサーの `contact:info` は可か（§21.2 #14）。
14. **同一レジストラ ID からの `transfer/request`** — 自分がスポンサーのドメインに送ったときの result code（§21.2 #15）。
15. **移管系の result code と `period`** — 実際に返るコード（2202 / 2106 / 2300 / 2301 / 2304 …）。
    `transfer/request` に `period` を渡せるか、完了時に exDate が延びるか（§21.2 #16）。
16. **transfer query の専用エンドポイントは無い**（確定事項として記録）。`DomainTransferRequest.op` の enum に
   `query` はあるが、paths には request / approve / reject / cancel しか無い。
   移管状態の照会は `domain:info` の `pendingTransfer` ステータスで代替する。
   このため approved / rejected / cancelled は照会では区別できず、状態遷移の検知は Poll が主になる（ADR-0002）。

## 4. 検証時の注意

Swagger UI の「Try it out」は**実データに反映される**（create / update / delete / transfer）。
動作確認は副作用のない `sessions/hello` → `domains/check` の順で始める。
契約テストの fixture は本ディレクトリ配下に置く（`CLAUDE.md`）。
