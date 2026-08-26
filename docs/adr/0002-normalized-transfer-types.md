# ADR-0002: 移管・Poll の正規化型

- 日付: 2026-08-26
- 状態: 採用
- 関連: `docs/requirements.md` §6.5 / §9.1 / §11.1 / §11.5、`docs/registry/spec-notes.md` §1「移管フロー」/ §3、issue #26

## 背景

両レジストリの OpenAPI（2026-08-25 取得）を精査した結果、移管まわりで次の 3 つが確定した。
いずれも `packages/shared` の正規化型の形を決めてしまう事実なので、ここに残す。

1. **transfer query の専用エンドポイントが無い。** `DomainTransferRequest.op` の enum には
   `query` があるが、`paths` には `request` / `approve` / `reject` / `cancel` しか無い。
2. **`domain:info` の応答に `clID`（現スポンサーレジストラ）が無い。** kitaqsign の
   `DomainResponse` と kitaqnic の `DomainInfoResponse` のプロパティを全数確認し、
   `registrar` を含むプロパティは `DomainTransferResponse` の 2 つだけだった。
3. **移管応答のフィールドがレジストリで違う。** kitaqnic だけが `reDate`（必須）/
   `acDate`（任意）を返し、kitaqsign はどちらも持たない。新有効期限にあたる `exDate` は
   どちらにも無い。`status` は両方 `string` としか宣言されておらず enum も例も無い。

## 決定

1. **移管の状態遷移は Poll 通知を主情報源にする**
   - 専用エンドポイントが無いので `transferQuery` は `domain:info` の `pendingTransfer`
     の有無から導出するしかない。これでは「移管中か否か」しか分からず、
     approved / rejected / cancelled を区別できない。
   - したがって承認・拒否・取消の検知は Poll に寄せる。Poll は最古の未 ack を 1 件返す
     FIFO で、ack するまで次が読めない（`docs/registry/spec-notes.md`「非同期通知（Poll）」）。
     エンドポイントはレジストリで違う（kitaqsign は `GET /messages/poll` + `POST /messages/{id}/ack`、
     kitaqnic は `GET /messages` + `DELETE /messages/{id}`）ので、アダプタで吸収する（#44）。
   - `transferQuery` は「pending か否か」だけを返す照会と割り切る。現在の利用者は
     AC-18-2 の `transferRequest` タイムアウト照合（`apps/api/src/lib/reconcile.ts`）と
     `GET /transfers/:name` の 2 つで、どちらも pending / none の区別しか使わない。

2. **`TransferResult.status` に `'none'` を持たせる**
   - 上の帰結。`transferQuery` が「移管中でない」を返すための値で、
     `apps/api/src/routes/transfers.ts` の照合（`status === 'pending'`）が依存する。
   - `transfers.status`（§9.1）は従来どおり 4 値のままにし、`'none'` は永続化しない。
     正規化型が DB の値域の上位集合になる、という非対称を許容する。

3. **`gainingRegistrar` / `losingRegistrar` を `requestingRegistrarId` / `actingRegistrarId` に改名する**
   - レジストリの語彙は「移管先 / 現スポンサー」という**申請時点の役割語**で、
     承認・拒否・取消の応答や Poll 通知では direction（in / out）と一対一にならない。
   - 「申請した側 / 対応する側」という視点非依存の語彙にし、direction の導出は
     自レジストラ ID（`adapter.registrarId`。追加は #43）との比較としてアプリ側で行う。
   - DB は `counterpart_registrar_id`（§9.1）という第 3 の語彙なので、
     どちらへの変換もアダプタ / サービス層の内側に閉じる。

4. **`DomainInfo.sponsoringRegistrarId` は型だけ用意し、当面 null で返す**
   - 背景 2 のとおり供給源が無い。型を先に置くことで §6.5（移管 OUT 検知）と
     §9.1（`domains.sponsoring_registrar_id`）の設計を変えずに済む。
   - 実測（【要確認: §21.2 #12】）で判明したら §11.5 の手順に従い、
     アダプタの `domainResDataSchema` とマッピングだけを足す（`packages/shared` は変えない）。
   - mock も同じく null を返す。実レジストリが返さないものを mock だけが返すと、
     mock でだけ通る実装を書いてしまうため。

5. **`raw`（レジストリの生応答）を正規化型に持たせ、型は `unknown` にする**
   - Poll の `payload` の中身と `status` の値域が未確定な間、情報を捨てない。
     `transfers.raw`（§9.1）への保存・障害調査（svTRID の突合）・契約テストの
     fixture 化（#48）に使う。
   - 実レジストリはエンベロープ（`EppEnvelope`）をそのまま入れる。`transferQuery` は
     導出元である `domain:info` のエンベロープを入れる。mock は JSON 化できる
     状態スナップショットを入れる。
   - 型を `unknown` にするのは、`packages/shared` が `packages/registry` の
     `EppEnvelope` に依存しないため（レジストリ固有処理を registry の外に出さない）と、
     使う側に zod での narrowing を強制するため。

6. **API 境界では `raw` を落とす**
   - `packages/shared` に `transferResponseSchema` / `toTransferResponse` を置き、
     `/transfers` の応答はこの DTO にする。FR-18 がエラー経路について定める
     「統一エラー形式で返し、レジストリの文言はユーザー向けメッセージに置き換える」を
     成功応答にも広げる形で、レジストリの生の出力は画面に流さない
     （NFR-03 の「クライアントに露出しない」とも同じ方向）。
   - web はこのスキーマを import して応答を検証する（従来は web 側が同じ形の zod を
     独立に持っており、API を改名しても `pnpm check` が緑のまま実行時に壊れる状態だった）。

7. **レジストリの生 `status` は正規化しつつ `registryStatus` に必ず残す**
   - 値域が未確定なので、EPP（RFC 5731）の trStatus 語彙（`pending` / `clientApproved` /
     `serverApproved` / `clientRejected` / `clientCancelled` / `serverCancelled`）を前提に
     部分一致で寄せ、**未知値は例外にせず `pending` に倒す**（受理応答を落とさないため）。
   - この推測が外れても `registryStatus` の生値から復元できる。

8. **`PollMessage.id` は string に正規化する**
   - レジストリは int64 で返すが、`transfers.registry_message_id`（§9.1）は text の
     一意キーで、JS の number では桁が落ちうる。
   - ack のパスパラメータは integer なので、URL に埋める際に数値へ戻す責務は
     アダプタ側（`packages/registry`）に置く（実装は #44）。

9. **`PollMessage.type` は正規化側の語彙で、`'unknown'` を持つ**
   - 両 OpenAPI の `PollMessageDto.msgType` に enum も例も無い【要確認: §21.2 #13】。
     対応づけられない通知も捨てずに `'unknown'` として持ち上げる。
   - `operation_logs.command` の `transfer_approve` 等とは別語彙（コマンド名は現在形、
     Poll の種別は「起きた事実」なので過去形）。重なるのは `transfer_request` だけ。

## 却下した案

- **`TransferResult.status` をレジストリの生 string のままにする（現行実装）**:
  値域が未確定なまま UI と DB が生値に依存し、レジストリ側の表記ゆれで壊れる。
- **未知の生 status を `REGISTRY_SPEC_MISMATCH` にする**: 値域が未確定な今それをやると、
  レジストリが想定外の文字列を返した瞬間に移管が全滅する。生値を残して倒す方が安全側。
- **`transferQuery` を `Promise<TransferResult | null>` にして `'none'` をやめる**:
  ルートと web の応答形まで変わり、`'none'` を消す以上の利益が無い。
- **`gainingRegistrar` / `losingRegistrar` の語彙を維持する**: direction の導出ロジックが
  レジストリ語彙のままアプリ側に漏れる。
- **`raw` を `Record<string, unknown>` にする**: 配列・プリミティブが来る可能性を型で塞ぎ、
  代入のたびにアサーションが要る。
- **`raw` を API 応答に素通しし、web の zod が未知キーを strip するのに任せる**:
  ネットワーク上には出てしまうので、上の方針の意味が無い。
- **`DomainInfo.sponsoringRegistrarId` を optional（`?: string`）にする**: 「まだ実装していない」
  と「レジストリが返さない」が区別できない。`raw_info`（jsonb）の往復比較も不安定になる。

## 影響

- `packages/shared` の正規化型が変わるため、`packages/registry`（kitaq / mock）、
  `apps/api`（`/transfers` ルート・`raw_info` の zod）、`apps/web`（応答スキーマ）が同 PR で追随する。
- `domains.raw_info` に保存済みの行には `sponsoringRegistrarId` キーが無い。
  `storedInfoSchema` は既定 null で受け、既存行を fallback に落とさない。
- **`RegistryAdapter` インターフェースには手を入れない。** §11.1 が挙げる `registrarId` /
  `transferApprove` / `transferReject` / `transferCancel` / `poll` / `ackMessage` は未実装のまま残す
  （追加は #43 / #44）。本 ADR は型の受け皿を用意するだけで、`PollMessage` の生産者はまだ居ない。
- mock の `transferQuery` は移管中に相手レジストラ ID を返すが、実アダプタは `info` からの
  導出なので返せない。これは §11.1 が mock に相手レジストラのシミュレーションを求めている
  ためで意図的だが、**direction の導出を `transferQuery` の戻り値に頼ると mock でだけ動く**。
  direction の情報源は `transferRequest` の応答と Poll 通知（#43 / #44）にする。
- `transferQuery` が pending / none しか返せない結果、`transferRequest` のタイムアウト照合は
  「申請が届いていない」と「届いたが既に完了した」を区別できない（後者も 504 になる）。
  これも Poll を主情報源にする理由で、解消は移管の永続化（#56）で扱う。
- `newExpiresAt` は当面つねに undefined。埋めるには移管完了後に `info` を追い読みする必要があり、
  その判断は移管の永続化（#56）で行う。
- Poll（`PollResponse` / `PollMessageDto`）の契約テスト fixture は #44 で追加する。
  transfer の fixture の `status` は実応答が未取得のため暫定値（`docs/registry/fixtures/README.md`）。
- `apps/web` の `domainInfoSchema` には `sponsoringRegistrarId` を足していない。
  web に消費者が無く、zod の `z.object` が未知キーを落とすだけで実害が無いため。
  移管 OUT を画面に出す（#56 以降）タイミングで足す。
