# レジストリ契約テスト用 fixture

`packages/registry` の契約テスト（`envelope.test.ts` 等）が読み込むレスポンス例。

- 形は各レジストリの Swagger（`docs/registry/*.openapi.json`）と実測（`docs/registry/spec-notes.md`）に基づく。
- `result.message` は実測に合わせている（Swagger 本文の例は `msg` だが実際は `message`）。
- レジストリの仕様変更通知を受けたら、新しい実レスポンスで fixture を更新し、
  契約テストをグリーンにしてから該当アダプタを修正する（requirements.md §11.5）。
  そのとき**変更の記録を先に**
  [`../kitaqsign/CHANGELOG.md`](../kitaqsign/CHANGELOG.md) /
  [`../kitaqnic/CHANGELOG.md`](../kitaqnic/CHANGELOG.md) へ残す（§11.5 の手順 1）。

## 一覧

| fixture | 対象コマンド | 備考 |
|---|---|---|
| `hello.kitaqsign.json` / `hello.kitaqnic.json` | `hello` | resData の形がレジストリで違う（`tlds` / `info.supportedTlds`） |
| `check.json` | `check` | `results[].avail` / `reason` |
| `domain-info.json` | `info` | `DomainResponse`。正規化 `DomainInfo` の基準 |
| `domain-info.pending-transfer.json` | `info` / `transferQuery` | `status` に `pendingTransfer`。移管中の導出に使う |
| `create.json` | `create` | `DomainCreateResponse`（domain / crDate / exDate） |
| `contact-create.json` | `contact_create` | `Unit`（空）。`create` の前段 |
| `renew.json` | `renew` | `DomainRenewResponse`（domain / exDate） |
| `update.kitaqsign.json` | `update` | kitaqsign は `DomainResponse` を返す（info を追い読みしない） |
| `update.kitaqnic.json` | `update` | kitaqnic は `Unit`（空）。アダプタは info で取り直す |
| `delete.json` | `delete` | `Unit`（空）。返す名前は要求から決まる |
| `restore.json` | `restore` | `Unit`（空）。状態は info で取り直す |
| `rotate-auth-info.json` | `auth_info` | `MapStringString`（`authInfo` キー） |
| `transfer-request.kitaqsign.json` / `.kitaqnic.json` | `transfer_request` | kitaqnic だけが `reDate` / `acDate` を返す |
| `transfer-approve.json` | `transfer_approve` | `status: clientApproved` → `approved` に正規化 |
| `poll.kitaqnic.request.json` | `poll` | **kitaqnic 実機のキャプチャ**（2026-08-27）。移管 request 通知の実測形 |
| `poll.kitaqsign.json` / `poll.kitaqnic.json` / `poll-empty.json` | `poll` | 旧想定形 2 パターン（kitaqsign 用に維持）と未読なし |
| `error-2202.json` | 移管系 | AuthCode 不一致 → `REGISTRY_REJECTED`（AC-12-2） |
| `error-2302.json` | `create` / `host_create` | 既存 → `CONFLICT` |
| `error-2303.json` | `info` / `host_info` | 不在 → `NOT_FOUND` |
| `error-2304.json` | 更新系・移管系 | ステータスによる拒否 → `OPERATION_NOT_ALLOWED` |
| `error-2306.json` | `renew` 等 | パラメータ方針違反 → `REGISTRY_REJECTED` |

`Unit`（空 resData）を返すコマンドは、fixture 単体では「何が起きたか」を表現できない。
契約テストはそこを見るのではなく、**アダプタが後続で `info` を呼んで状態を取り直すこと**を
確かめる（`delete` / `restore` / kitaqnic の `update`）。

## 暫定値を含む fixture

`transfer-request.*.json` の `resData.status` は暫定値。両レジストリの OpenAPI で
`DomainTransferResponse.status` は `string` としか宣言されておらず、enum も example も無い
（実応答も未取得。requirements.md §21.2 #13）。契約テストは正規化の対応づけを
`registryStatus`（生値の保持）側で確かめ、この暫定値そのものには依存させないこと。

レジストリ差分の要点は次のとおりで、fixture もこの差を再現している。

- `transfer-request.kitaqnic.json`: kitaqnic だけが `reDate`（必須）/ `acDate`（任意）を返す
- `transfer-request.kitaqsign.json`: kitaqsign は両方持たない（`requestedAt` / `actByAt` は undefined）
- 新有効期限に相当する `exDate` はどちらの transfer 応答にも無い

`poll` の `message.msgType` と `payload` は、両 OpenAPI が `msgType: string` /
`payload: object`（`additionalProperties`）としか宣言しておらず enum も example も無いため、
長らく暫定値だった（旧 requirements.md §21.2 #13）。**2026-08-27 の kitaqnic 実機の移管 E2E で
実測が取れた**（#175 / #176。経緯は [`../kitaqnic/CHANGELOG.md`](../kitaqnic/CHANGELOG.md)）。

- `poll.kitaqnic.request.json`: **実測形**。`msgType` は `"domain:transfer"` 固定で、動詞は
  `payload.op`（`request` / `approve` / `reject`）。`payload` は
  `{ op, domain, counterpartyRegistrar }` の 3 フィールドだけで、`counterpartyRegistrar` は
  受信者から見た相手 1 個。`qdate` はタイムゾーン無しのマイクロ秒精度。
  アダプタの正規化はこの形を正とする。
- `poll.kitaqsign.json`: 旧想定形（`payload.status` へのフォールバック）。**kitaqsign は
  メンテナンス中で未実測**のため、アダプタが旧形も読める状態を維持していることの回帰として残す
  （`docs/specs/registry-api.md` §3-12）。
- `poll.kitaqnic.json`: 旧想定形（`msgType` に動詞 `transferApproved` が入る例）。同上の回帰用。
- `poll-empty.json`: 未読なし（`resData.count = 0` / `message` 無し）。アダプタは `null` を返す

契約テストは引き続き「未知の `msgType` でも通知を落とさない（`unknown` に倒す）」ことも確かめる。

**Poll の応答の形は両レジストリで完全に同一**で、違うのはエンドポイントだけ
（kitaqsign は `GET /messages/poll` + `POST /messages/{id}/ack`、kitaqnic は
`GET /messages` + `DELETE /messages/{id}`）。fixture をレジストリ別に分けているのは
`msgType` の揺れの両パターンを残すためで、スキーマの差ではない。
