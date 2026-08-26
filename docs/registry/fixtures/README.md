# レジストリ契約テスト用 fixture

`packages/registry` の契約テスト（`envelope.test.ts` 等）が読み込むレスポンス例。

- 形は各レジストリの Swagger（`docs/registry/*.openapi.json`）と実測（`docs/registry/spec-notes.md`）に基づく。
- `result.message` は実測に合わせている（Swagger 本文の例は `msg` だが実際は `message`）。
- レジストリの仕様変更通知を受けたら、新しい実レスポンスで fixture を更新し、
  契約テストをグリーンにしてから該当アダプタを修正する（requirements.md §11.5）。

## 暫定値を含む fixture

`transfer-request.*.json` の `resData.status` は暫定値。両レジストリの OpenAPI で
`DomainTransferResponse.status` は `string` としか宣言されておらず、enum も example も無い
（実応答も未取得。requirements.md §21.2 #13）。契約テストは正規化の対応づけを
`registryStatus`（生値の保持）側で確かめ、この暫定値そのものには依存させないこと。

レジストリ差分の要点は次のとおりで、fixture もこの差を再現している。

- `transfer-request.kitaqnic.json`: kitaqnic だけが `reDate`（必須）/ `acDate`（任意）を返す
- `transfer-request.kitaqsign.json`: kitaqsign は両方持たない（`requestedAt` / `actByAt` は undefined）
- 新有効期限に相当する `exDate` はどちらの transfer 応答にも無い

Poll（`PollResponse` / `PollMessageDto`）の fixture は poll / ackMessage の実装（#44）で追加する。
