# Kitaqnic 仕様変更ログ

`docs/requirements.md` §11.5「仕様変更通知への対応手順」の手順 1 の記録先。
運営から仕様変更の通知が来たら、**まずここに追記してから**アダプタに手を入れる。

- 仕様の正は Swagger UI: <https://docs.kitaqnic.com/swagger-ui/index.html>（`/v3/api-docs`）
- 取得済みの OpenAPI 定義: [`../kitaqnic.openapi.json`](../kitaqnic.openapi.json)
- 差分の要約: [`../spec-notes.md`](../spec-notes.md)
- 契約テストの fixture: [`../fixtures/README.md`](../fixtures/README.md)
- アダプタと `specVersion`: `packages/registry/src/kitaq.ts`

---

## 2026-08-27 — `.org` / `.info` の管轄を kitaqsign から引き継いだ

| 項目 | 内容 |
|---|---|
| 種別 | 運営からの事前周知（8/27 16:00〜、数分程度のメンテナンス。作業中は両レジストリとも一時停止） |
| `specVersion` | `v2 (2026-08-27)` に更新（対応 TLD という契約レベルの変更のため） |
| fixture 更新 | `../fixtures/hello.kitaqnic.json`（`supportedTlds` に `org` / `info` を追加） |
| 影響 FR | FR-04 / FR-05（候補生成・空き確認のルーティング）/ FR-06〜FR-12（`.org` / `.info` の全ドメイン操作） |

- kitaqnic の管轄 TLD は **20 種**になった（従来の 18 gTLD + `.org` `.info`）。接続先は従来どおり
  EPP: `epp.kitaqnic.com` / コンパネ: `console.kitaqnic.com` / RDAP: `rdap.kitaqnic.com`（環境変数の変更は不要）。
- 既存の `.org` / `.info` ドメインは**コンタクト・ホスト含むデータごと kitaqnic に引き継がれる**
  （保有者・コンタクト ID は変わらない）。アプリ側は `domains.registry` / `transfers.registry` を
  付け替えるデータマイグレーションで追随（`packages/db/drizzle`）。
- kitaqsign 側の記録は [`../kitaqsign/CHANGELOG.md`](../kitaqsign/CHANGELOG.md) 同日エントリ。

## 2026-08-27 — Poll 移管通知の実測形が判明し、`add.statuses` も反映されるようになった

| 項目 | 内容 |
|---|---|
| 種別 | 実測で判明（teamb ↔ teamb-2 の移管 E2E）＋ 運営からの修正アナウンス |
| `specVersion` | 未更新（`v1 (2026-08-25)` のまま。OpenAPI スキーマ自体は変わっていない） |
| fixture 更新 | `../fixtures/poll.kitaqnic.json` / `poll.kitaqnic.request.json` を実測形に差し替え |
| 影響 FR | FR-12（移管）/ FR-09（ドメインロック）/ FR-02（Poll 消化） |

### Poll 移管通知（#175 / #176）

Swagger には `msgType` / `payload` の中身の記載が無く、それまでは推測で実装していた。実測の結果:

- `msgType` は **`"domain:transfer"` 固定**。動詞は `payload.op`（`request` / `approve` / `reject`。
  `cancel` は op の enum から推定・未実測）。
- `payload` は `{ op, domain, counterpartyRegistrar }` の 3 フィールドのみ。
  `counterpartyRegistrar` は**受信者から見た相手 1 個**（Swagger 推測にあった `status` /
  `gainingRegistrar` / `losingRegistrar` / `reDate` / `acDate` は来ない）。
- `qdate` はタイムゾーン無しのマイクロ秒精度（例 `2026-08-27T12:16:52.607727`）。
- 宛先: `request` は losing に、`approve` / `reject` は gaining に積まれる。
- アダプタの正規化を実測形（`payload.op` を見る）に修正した。旧想定形（`msgType` に動詞 /
  `status` フォールバック）も kitaqsign 用に読める状態で残している。

非スポンサーからの `domain:info` は**拒否されず成功し全ステータスが見える**が、`clID`
（現スポンサー）は含まれない。そのため移管 OUT 完了の検知は Poll の承認通知が主のまま。

### `add.statuses` / `rem.statuses`

運営が 2026-08-27 に修正をアナウンス。実測で確認:
`add.statuses: ["clientTransferProhibited"]` が `domain:info` に反映され、ロック中の
`transfer/request` は **result 2304**（Object status prohibits operation）で拒否される。
`rem.statuses` での解除も動く。FR-09 の「ロック」トグルが動作可能になった。

## 2026-08-25 — 初版（Swagger 取得）

| 項目 | 内容 |
|---|---|
| 種別 | 初回取り込み |
| `specVersion` | `v1 (2026-08-25)`（`packages/registry/src/kitaq.ts` の `SPEC_VERSION`） |
| fixture 更新 | `../fixtures/*.json` を作成 |
| 影響 FR | 全レジストリ連携（FR-02 / 03 / 06〜12） |

`registry-kitaqnic EPP-over-REST API (18 gTLD)` v1 / OAS 3.0 を取得。
Swagger 本文と実測で以下の差異を確認した（詳細は `../spec-notes.md`）。

- **`result.msg` ではなく `result.message`** — Swagger 本文の例は `"msg"` だが、実際のレスポンスは
  `"message"` を返す（`hello` で確認）。zod スキーマは `message` を必須にし、`msg` は受けない。
- **`add.statuses` / `rem.statuses` が反映されない** — result 1000 は返るが `domain:info` の
  status が変わらない（2026-08-27 に解消。上記参照）。
- **`hello` の `resData` の形が kitaqsign と違う** — kitaqnic は `svID` / `svDate` / `svcMenu` / `info`
  （EPP greeting に近い）。対応 TLD は `resData.info.supportedTlds` から取る。
- **poll / ack のエンドポイントが違う** — kitaqnic は `GET /messages` + `DELETE /messages/{id}`。
- **`domain:update`（PUT）の応答が空** — `EppResponseUnit` を返すので、更新後の情報は `info` で取り直す。
- **`DomainTransferResponse` に `reDate`（必須）/ `acDate`（任意）がある** — kitaqsign には無い。
  これが `TransferResult.requestedAt` / `actByAt` を optional にしている理由（ADR-0002）。
- **対応 TLD は 18 gTLD で kitaqsign と重複なし** — TLD からレジストリが一意に決まる。
- **svTRID プレフィクスは `KQNIC-`**、宣言 extension に `premium` / `launch` / `fee` がある。

---

## 追記テンプレート

新しい通知を受けたら、このセクションをコピーして**上の一番新しいエントリの上**に貼る（新しい順）。

```markdown
## YYYY-MM-DD — <変更の要約を 1 行で>

| 項目 | 内容 |
|---|---|
| 種別 | 運営からの通知 / 実測で判明 / Swagger 更新 |
| `specVersion` | 更新後の値（`packages/registry/src/kitaq.ts` の `SPEC_VERSION`）。据え置きならその旨 |
| fixture 更新 | 更新した `../fixtures/*.json`。無ければ「なし」 |
| 影響 FR | FR-xx / AC-xx。無ければ「なし」 |

- 何がどう変わったか（Before → After）
- アダプタのどこを直したか（`packages/registry` のファイル・関数）
- 契約テストの結果
```

§11.5 の手順 2〜5（アダプタ修正 → 契約テスト → `specVersion` 更新 → 影響 FR の反映）は
このエントリを書いてから進める。
