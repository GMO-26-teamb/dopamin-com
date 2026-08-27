# Kitaqsign 仕様変更ログ

`docs/requirements.md` §11.5「仕様変更通知への対応手順」の手順 1 の記録先。
運営から仕様変更の通知が来たら、**まずここに追記してから**アダプタに手を入れる。

- 仕様の正は Swagger UI: <https://docs.kitaqsign.com/swagger-ui/index.html>（`/v3/api-docs`）
- 取得済みの OpenAPI 定義: [`../kitaqsign.openapi.json`](../kitaqsign.openapi.json)
- 差分の要約: [`../spec-notes.md`](../spec-notes.md)
- 契約テストの fixture: [`../fixtures/README.md`](../fixtures/README.md)
- アダプタと `specVersion`: `packages/registry/src/kitaq.ts`

---

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
