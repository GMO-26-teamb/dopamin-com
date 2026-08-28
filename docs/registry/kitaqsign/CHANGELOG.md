# Kitaqsign 仕様変更ログ

`docs/requirements.md` §11.5「仕様変更通知への対応手順」の手順 1 の記録先。
運営から仕様変更の通知が来たら、**まずここに追記してから**アダプタに手を入れる。

- 仕様の正は Swagger UI: <https://docs.kitaqsign.com/swagger-ui/index.html>（`/v3/api-docs`）
- 取得済みの OpenAPI 定義: [`../kitaqsign.openapi.json`](../kitaqsign.openapi.json)
- 差分の要約: [`../spec-notes.md`](../spec-notes.md)
- 契約テストの fixture: [`../fixtures/README.md`](../fixtures/README.md)
- アダプタと `specVersion`: `packages/registry/src/kitaq.ts`

---

## 2026-08-28 — 日時は JST の壁時計値（`Z` 付きでも UTC ではない）と実測で判明

| 項目 | 内容 |
|---|---|
| 種別 | 実測で判明（#289） |
| `specVersion` | 未更新（`v2 (2026-08-27)` のまま。OpenAPI スキーマ自体は変わっていない） |
| fixture 更新 | なし（`Z` 付きの形はそのまま実測どおり。解釈の変更は `../fixtures/README.md` に記載） |
| 影響 FR | FR-02（`registered_at` 等のキャッシュ）/ AC-02-2（有効期限 30 日警告）/ FR-12 |

- `domain:info` 等の `crDate` / `upDate` / `exDate` / `trDate` は **`Z` 付きで返るが中身は
  JST の壁時計値**。実測: 本番 DB の kitaqsign 全行で `registered_at` が行作成時刻より
  +9.0h（例: `naodevelops.com` created `04:12:31Z` / registered `13:12:31Z`。#289）。
- kitaqsign は transfer 応答に `reDate` / `acDate` を返さない（2026-08-25 エントリ）ため、
  移管カウントダウンはサーバ時刻フォールバックで偶然正しく、`.com` では実害が見えなかった。
  `registered_at` / `expires_at` のずれは初回登録時から出ていた。
- アダプタ対応は kitaqnic と共通: `packages/registry/src/kitaq-datetime.ts` の正規化
  （オフセット表記を無視して壁時計成分を JST と解釈 → UTC）を `kitaq.ts` の
  全日時マッピングに適用（[`../kitaqnic/CHANGELOG.md`](../kitaqnic/CHANGELOG.md) 同日エントリ）。

## 2026-08-27 — `.org` / `.info` の管轄が kitaqnic へ移管（kitaqsign では非対応に）

| 項目 | 内容 |
|---|---|
| 種別 | 運営からの事前周知（8/27 16:00〜、数分程度のメンテナンス。作業中は両レジストリとも一時停止） |
| `specVersion` | `v2 (2026-08-27)` に更新（対応 TLD という契約レベルの変更のため） |
| fixture 更新 | `../fixtures/hello.kitaqsign.json`（`tlds` から `org` / `info` を除外） |
| 影響 FR | FR-04 / FR-05（候補生成・空き確認のルーティング）/ FR-06〜FR-12（`.org` / `.info` の全ドメイン操作） |

- kitaqsign の管轄 TLD は **`.com` `.net` の 2 種**になった。`.org` / `.info` は kitaqnic の管轄
  （[`../kitaqnic/CHANGELOG.md`](../kitaqnic/CHANGELOG.md) 同日エントリ）。
- kitaqsign に `.org` / `.info` を投げると `domain:check` は **2306** を返し、`hello` の
  `tlds` からも外れる。ルーティングの正 `packages/shared/src/tlds.ts`（`REGISTRY_TLDS`）を
  更新したため、アプリからは到達しない。
- メンテナンス中は kitaqsign 自体も一時停止（EPP / RDAP / コンパネ）。

## 2026-08-27 — `domain:update` の `add.statuses` / `rem.statuses` が反映されるようになった

| 項目 | 内容 |
|---|---|
| 種別 | 運営からの修正アナウンス |
| `specVersion` | 未更新（`v1 (2026-08-25)` のまま。スキーマは変わっていないため） |
| fixture 更新 | なし |
| 影響 FR | FR-09（ドメインロックのトグル） |

- 2026-08-25 時点では `add.statuses` / `rem.statuses` が result 1000 を返すのに `domain:info` に
  反映されなかった（`spec-notes.md` §3 #10）。運営が 2026-08-27 に修正をアナウンス。
- **kitaqsign はこの時点でメンテナンス中のため未実測**。kitaqnic では実測で確認済み
  （[`../kitaqnic/CHANGELOG.md`](../kitaqnic/CHANGELOG.md)）。両レジストリで挙動は同一という
  前提（`spec-notes.md` §1「認証・エンベロープ・result code・値の制約は両者で同一」）に基づき、
  アダプタは共通実装のまま。**疎通できるようになったら実測して本ログに追記すること。**

## 2026-08-25 — 初版（Swagger 取得）

| 項目 | 内容 |
|---|---|
| 種別 | 初回取り込み |
| `specVersion` | `v1 (2026-08-25)`（`packages/registry/src/kitaq.ts` の `SPEC_VERSION`） |
| fixture 更新 | `../fixtures/*.json` を作成 |
| 影響 FR | 全レジストリ連携（FR-02 / 03 / 06〜12） |

`registry-kitaqsign EPP-over-REST API (対応 TLD: .com .net .org .info)` v1 / OAS 3.0 を取得。
Swagger 本文と実測で以下の差異を確認した（詳細は `../spec-notes.md`）。

- **`result.msg` ではなく `result.message`** — Swagger 本文の例は `"msg"` だが、実際のレスポンスは
  `"message"` を返す（`hello` で確認）。zod スキーマは `message` を必須にし、`msg` は受けない。
- **`add.statuses` / `rem.statuses` が反映されない** — result 1000 は返るが `domain:info` の
  status が変わらない（2026-08-27 に解消。上記参照）。
- **`hello` の `resData` の形が kitaqnic と違う** — kitaqsign は `registryCode` / `tlds` / `message`、
  kitaqnic は `svID` / `svDate` / `svcMenu` / `info`（EPP greeting に近い）。対応 TLD の取り出し先も
  `resData.tlds` と `resData.info.supportedTlds` で異なる。
- **poll / ack のエンドポイントが違う** — kitaqsign は `GET /messages/poll` + `POST /messages/{id}/ack`。
- **`domain:update`（PUT）の応答が違う** — kitaqsign は更新後のドメイン情報（`EppResponseDomainResponse`）を返す。
- **svTRID プレフィクスは `KQSGN-`**。

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
