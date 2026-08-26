# テストの実行方法

テスト方針の全体像は [requirements.md §19](requirements.md) を参照。ここでは実行手順をまとめる。

## 1. 通常のテスト（unit / contract・CI で常時実行）

```sh
pnpm test          # 全パッケージの Vitest
pnpm check         # lint + typecheck + test（PR 前に必須）
```

- 実レジストリには**一切接続しない**。認証情報が無くても動く。
- `apps/api` の API 統合テスト（`apps/api/test/routes/`）は Hono ルートを `app.request()` +
  mock レジストリで検証する。実レジストリには接続しない。
- 契約テスト（`packages/registry/src/envelope.test.ts` 等）は
  `docs/registry/fixtures/*.json` の fixture を読み込んで検証する。
  レジストリの仕様変更通知を受けたら fixture を更新して回帰を検出する（requirements.md §11.5）。
- DB を使うテスト（`apps/api`）は **pglite**（インメモリ Postgres 17、`@electric-sql/pglite`）を使う。
  外部の Postgres や `DATABASE_URL` は不要で、`pnpm test` だけでローカル・CI とも動く。
  - `apps/api/test/helpers/db.ts` の `createTestDb()` が `packages/db/drizzle/meta/_journal.json` の順に
    `packages/db/drizzle/*.sql` を適用したテスト DB を返す。`resetTestDb(db)` で全テーブルを空にできる。
  - `apps/api/src/lib/db.ts` の `setDbForTesting(db)` で API に注入する（`setRegistrySetForTesting` と同じ流儀）。
  - `apps/api/test/helpers/session.ts` の `createTestSession(db)` が `users` + `sessions` を作り、
    リクエストの `cookie` ヘッダに入れる文字列（`dopamin_session=<id>`）を返す
    （同ファイルの `installTestSession` は DB を立てずにセッション解決だけを差し替える軽量な seam。
    ルートの中身だけを見たいときはそちらを使う）。
  - 書き方（`apps/api/test/routes/auth.test.ts` 参照）:

    ```ts
    let db: Db;
    let closeDb: () => Promise<void>;
    beforeAll(async () => {
      process.env.DATABASE_URL = "postgres://unused:unused@localhost:1/unused"; // env() 用ダミー
      process.env.WEBAUTHN_RP_ID = "localhost";
      process.env.WEBAUTHN_ORIGIN = "http://localhost:3000";
      ({ db, close: closeDb } = await createTestDb());
      setDbForTesting(db);
    }, 30_000); // pglite の起動に 1〜2 秒かかる
    afterAll(async () => {
      setDbForTesting(null);
      await closeDb();
    });
    beforeEach(() => resetTestDb(db));
    ```

  - pglite の注意: `gen_random_uuid()` はそのまま使える（pgcrypto 不要）。`bytea` は `Uint8Array` で返る
    （postgres.js は `Buffer`）。`bigint` は安全な範囲なら `number`。pgvector が必要になったら
    `@electric-sql/pglite/vector` を `PGlite.create({ extensions: { vector } })` で有効化する。
  - SimpleWebAuthn の `verify*` は `vi.mock("@simplewebauthn/server", …)` で差し替える（契約テストは DB 更新を検証する）。

パッケージ単位で実行する場合:

```sh
pnpm --filter @dopamin/registry test
pnpm --filter @dopamin/shared test
pnpm --filter @dopamin/api test
```

## 2. 実レジストリ疎通テスト（apps/api/test/connect/）

Kitaqsign / Kitaqnic への接続が正常にできているかを、実レジストリに対する
フルライフサイクル（hello → check → create → info → renew → update →
authCode → transfer 拒否 → delete → restore → 最終 delete）で検証する。

```sh
pnpm --filter @dopamin/api test:connect
```

（内部で `REGISTRY_CONNECT_TEST=1 vitest run test/connect/` を実行する）

### 前提

- `apps/api/.env.local` に `KITAQSIGN_*` / `KITAQNIC_*` の認証情報
  （BASE_URL / GATE_USER / GATE_PASSWORD / REGISTRAR_ID / API_KEY）が設定されていること。
  無い場合はテストが失敗メッセージ付きで検知する。

### ⚠️ 注意（必読）

- **更新系コマンドが実データに反映される**（Swagger の Try it out と同じ）。
  テストは実行ごとに一意な `dopamin-t<タイムスタンプ><乱数>.com` / `.xyz` を実際に登録し、
  最後に削除して復旧猶予（RGP）状態で終える。レジストリ側に RGP 中のテスト用ドメインが残る。
  途中で失敗・中断しても `afterAll` で削除を試みるが、Ctrl-C 等では残ることがある
  （その場合は手動で `DELETE /domains/{name}` を実行する）。
- `REGISTRY_CONNECT_TEST=1` は**シェルの環境変数としてのみ**有効。
  `.env.local` に書いても無視される（誤って通常の `pnpm test` が実レジストリに向かないための仕様）。
  誤爆防止のため、環境変数を直接 export したまま作業しないこと。
- authCode ステップは `rotate-auth-info` を呼ぶため、対象ドメインの authInfo が毎回変わる。
- 既知の残留物: `domain:create` の前提となるコンタクト（ダミー PII、ID `dp-*`）が
  実行ごとに 1 件レジストリに残る（RGP 中のドメインが参照しているため削除できない）。

### 1 レジストリだけ実行する

```sh
REGISTRY_CONNECT_TEST=1 pnpm --filter @dopamin/api exec vitest run test/connect/kitaqsign.connect.test.ts
```

```sh
REGISTRY_CONNECT_TEST=1 pnpm --filter @dopamin/api exec vitest run test/connect/kitaqnic.connect.test.ts
```

## 3. mock レジストリのエラーシミュレーション（§11.6）

`apps/api/.env.local` で `REGISTRY_MODE=mock` のまま `MOCK_REGISTRY_FAIL_MODE` を
`timeout` / `5xx` / `reject` / `spec_mismatch` に切り替えると、API がエラー応答
（統一エラー形式 §10.3）を返すことを手元で確認できる。ユニットテストでは
`packages/registry/src/mock.test.ts` が同じ挙動を常時検証している。
