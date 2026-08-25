# レジストリ契約テスト用 fixture

`packages/registry` の契約テスト（`envelope.test.ts` 等）が読み込むレスポンス例。

- 形は各レジストリの Swagger（`docs/registry/*.openapi.json`）と実測（`docs/registry/spec-notes.md`）に基づく。
- `result.message` は実測に合わせている（Swagger 本文の例は `msg` だが実際は `message`）。
- レジストリの仕様変更通知を受けたら、新しい実レスポンスで fixture を更新し、
  契約テストをグリーンにしてから該当アダプタを修正する（requirements.md §11.5）。
