# テストの実行方法

テスト方針の全体像は [requirements.md §19](requirements.md) を参照。ここでは実行手順をまとめる。

自動テストで担保できない範囲（実レジストリへの副作用を伴う操作・他チームとの相互移管・
実ブラウザのパスキー・本番 URL での通し）は、発表前日に
[`specs/manual-checklist.md`](specs/manual-checklist.md) を全員で回して潰す（§19 の manual 行）。

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
    let closeDb: (() => Promise<void>) | undefined;
    beforeAll(async () => {
      process.env.DATABASE_URL = "postgres://unused:unused@localhost:1/unused"; // env() 用ダミー
      process.env.WEBAUTHN_RP_ID = "localhost";
      process.env.WEBAUTHN_ORIGIN = "http://localhost:3000";
      ({ db, close: closeDb } = await createTestDb());
      setDbForTesting(db);
    }, 30_000); // pglite の起動に 1〜2 秒かかる
    afterAll(async () => {
      setDbForTesting(null);
      await closeDb?.(); // beforeAll が timeout した場合に TypeError で本来の原因を隠さない
    });
    beforeEach(() => resetTestDb(db));
    ```

  - pglite の注意: `gen_random_uuid()` はそのまま使える（pgcrypto 不要）。`bytea` は `Uint8Array` で返る
    （postgres.js は `Buffer`）。`bigint` は安全な範囲なら `number`。pgvector が必要になったら
    `@electric-sql/pglite/vector` を `PGlite.create({ extensions: { vector } })` で有効化する。
  - SimpleWebAuthn の `verify*` は `vi.mock("@simplewebauthn/server", …)` で差し替える（契約テストは DB 更新を検証する）。
  - FR-01 の検証ロジック（challenge 期限切れ / 使用済み / 期限切れ行の掃除、signature counter 後退、
    userHandle 不一致、最後のパスキー削除、他人のパスキー）は `apps/api/src/services/auth.test.ts` が
    サービス関数を直接呼んで pglite で常時検証する。HTTP 経由の契約（Set-Cookie 等）は `test/routes/auth.test.ts`。

パッケージ単位で実行する場合:

```sh
pnpm --filter @dopamin/registry test
pnpm --filter @dopamin/shared test
pnpm --filter @dopamin/api test
```

### 性能テスト（`*.perf.test.ts`）は既定のテストから外してある

FR-05 の AC-05-3（独自性スコアの算出が 1 件あたり 1.5 秒以内）のように**時間を測るテスト**は、
`packages/shared/src/uniqueness/latency.perf.test.ts` に置き、`pnpm test` からは除外している
（`packages/shared/vitest.config.ts` の `exclude`）。単独実行はこちら:

```sh
pnpm --filter @dopamin/shared test:perf   # 設定は packages/shared/vitest.perf.config.ts
```

理由（#181 / #178）: CI の `check` ジョブは `turbo run typecheck test build` で api / web / shared の
テストと `next build` を**同時に**走らせる。GitHub Actions の runner は 2 コアなので、この状態で
計測すると 1 件あたりの実測がローカルの十数倍（実測 0.1 秒 → 2 秒）に膨らみ、AC を満たしていても
CI が落ちる。予算を甘くすると本当の退行を検出できなくなるため、**予算ではなく計測条件のほうを直した**。
CI では `check` ジョブの最後に、他の処理が終わってから単独ステップとして走らせている。

それでも共有ランナーには多少のゆらぎがあるので、テスト側も
ウォームアップぶんを捨てて複数回計測した**中央値**で判定し、取れる環境では壁時計ではなく
**CPU 時間**（`process.cpuUsage`）を使う。FR-05 は外部 I/O を持たない純 CPU 処理なので、
本番（Vercel Functions）では壁時計 ≒ CPU 時間になり AC の意味は保たれる。

時間を測らない AC（AC-05-1 の「有名名は low」など）は
`packages/shared/src/uniqueness/ac.test.ts` に置き、通常のテストで常時検証する。

API のカバレッジ（`src/**/*.ts`、テストファイルを除く）を確認する場合:

```sh
pnpm --filter @dopamin/api test:coverage
```

statement / branch / function / line の各指標に 80% の下限を設けている。

## 2. 実レジストリ疎通テスト（apps/api/test/connect/）

Kitaqsign / Kitaqnic への接続が正常にできているかを、実レジストリに対する
フルライフサイクル（hello → check → create → info → renew → update →
authCode → transfer 拒否（誤 AuthCode の request / 申請不在の approve・reject・cancel）→
delete → restore → 最終 delete）で検証する。

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

### 相手レジストラを使う Hono API 移管 E2E

`apps/api/.env.local` をアプリ側、`apps/api/.env.test` を相手レジストラ側として、
Kitaqnic の移管を Hono API 経由で一巡する手動テスト:

```sh
pnpm --filter @dopamin/api test:connect:transfer
```

- 両ファイルに `KITAQNIC_*` 5 項目が必要で、`KITAQNIC_REGISTRAR_ID` は互いに異なること。
- アプリ側の登録・Poll・拒否・承認・取消・再取り込み・廃止は `app.request()` を通す。
  相手側の申請・承認だけを実アダプタで実行する。
- 通常の `pnpm test` / CI では skip される。実行時は一意な `.xyz` を登録し、最後に廃止して
  RGP に入れる。途中失敗時も両レジストラから取消・削除を試み、回収できなければ対象名を警告する。
- AuthCode、API キー、gate パスワード、レジストリ生応答はログに出さない。

## 3. e2e（Playwright + CDP Virtual Authenticator、FR-01 / デモシナリオ）

`apps/web/e2e/passkey.spec.ts` が、実ブラウザ（Chromium）でサインアップ → ログアウト → ログイン →
パスキーの追加 / 削除 → 未認証リダイレクト（AC-01-1〜3）を通しで検証する。WebAuthn の生体認証は
CDP の `WebAuthn.addVirtualAuthenticator` で肩代わりするので、ダイアログは出ない。
仮想認証器とサインアップの手順は `apps/web/e2e/support/webauthn.ts` に切り出して spec 間で共有する。

`apps/web/e2e/demo-scenario.spec.ts` は発表用デモ（requirements.md §3.3 の 1〜5 /
`specs/manual-checklist.md` §6 の 6-1〜6-5）を 1 本で通す: パスキーでサインアップ →
直接検索（S-24）で空き確認 + 独自性スコア → 登録ダイアログ → モック決済（S-29）→ 登録成功（S-26）→
保有一覧（S-10）に出る → サブドメイン設計を保存（AC-13-3）→ DNS 反映で全ホストが `反映済み`（S-45）。
**AI と GitHub に出る経路は通さない**（AI プロバイダのキーの有無・レート制限で結果が変わり CI が不安定になるため）:
デモ手順 6-2 の AI 候補生成は直接検索で代替し、サブドメイン設計は `PUT /domains/:name/subdomain-plan`
（AI を使わない保存 API）で用意してから画面で編集・保存・反映する。AI 経路は `apps/api` の
unit / 統合テストが mock で常時検証している。

web は `NEXT_PUBLIC_API_MODE=http`（`next build && next start`、:3000）、api は `REGISTRY_MODE=mock` +
Postgres（:8787）で、`apps/web/playwright.config.ts` の `webServer` から自動起動する。
**実レジストリ・Supabase には接続しない**（`apps/api/.env.local` は読まない）。

### 初回だけ

```sh
pnpm --filter @dopamin/web e2e:install      # Chromium を取得
docker run --name dopamin-e2e-pg -e POSTGRES_PASSWORD=postgres -p 54329:5432 -d postgres:17
DIRECT_DATABASE_URL=postgres://postgres:postgres@localhost:54329/postgres pnpm --filter @dopamin/db migrate
```

2 回目以降は `docker start dopamin-e2e-pg`。マイグレーションを増やしたら migrate を再実行する。

### 実行

```sh
pnpm --filter @dopamin/web e2e              # ヘッドレス
pnpm --filter @dopamin/web e2e --headed     # ブラウザを見ながら（pnpm は `--` なしで引数を渡す）
pnpm --filter @dopamin/web e2e --ui         # Playwright UI
```

### 注意

- RP ID が `localhost` 固定なので baseURL は `http://localhost:3000`。`127.0.0.1` では動かない（FR-01 spec §6）。
- api（:8787）は既存プロセスを**再利用しない**（`reuseExistingServer: false`）。`pnpm dev` の api は
  `apps/api/.env.local`（Supabase / 実レジストリ）を読んでいる可能性があり、掴むと signup やパスキー追加・削除が
  共有 DB に書き込んでしまうため。:8787 が使用中だと Playwright が「is already used」で即失敗するので、
  `pnpm dev` を止めるか、下の `E2E_API_PORT` / `E2E_WEB_PORT` でポートを退避してから実行する。
- web（:3000）だけは既存プロセスを再利用する（`next build` を省くため）。`pnpm dev` の web（mock モード）を掴むと
  最初のテスト（AC-01-3 のリダイレクト）が失敗する。e2e が起動した web は次回の実行で再利用されるので、
  2 回目以降は `next build` を待たずに済む（web のコードを変えたら :3000 を止めて再ビルドさせる）。
- DB の接続先はローカルでは環境変数 `E2E_DATABASE_URL`（未設定なら上の docker の 54329）。シェルの `DATABASE_URL`
  （`pnpm dev` 用に Supabase を指していることがある）は**読まない**。CI だけは `DATABASE_URL`（`services: postgres`）を
  必須として読む。表示名も登録するドメイン名も毎回ユニークにしているので、同じ DB で繰り返し実行できる。
- `next build` は `next/font/google` のフォント取得でネットワークを使う。
- CI は `.github/workflows/ci.yml` の `e2e` ジョブ（`services: postgres`）。Playwright の step に `continue-on-error: true` を
  付けて必須にはしていない（check run は緑のまま）。失敗時は Summary に `::warning::` が出て、`playwright-report`
  アーティファクトにトレース / スクリーンショットが残る。
- turbo の `test` には含めない（`pnpm test` / `pnpm check` は e2e を走らせない）。
- ポートは既定 3000 / 8787 だが、`E2E_WEB_PORT` / `E2E_API_PORT` で退避できる。`pnpm dev` を止めずに
  回したいときに使う（例: `E2E_WEB_PORT=3411 E2E_API_PORT=8811 pnpm --filter @dopamin/web e2e`）。
  RP ID は `localhost` 固定でポートに依存せず、`WEBAUTHN_ORIGIN` は config が web と揃える。

## 4. mock レジストリのエラーシミュレーション（§11.6）

`apps/api/.env.local` で `REGISTRY_MODE=mock` のまま `MOCK_REGISTRY_FAIL_MODE` を
`timeout` / `5xx` / `reject` / `spec_mismatch` に切り替えると、API がエラー応答
（統一エラー形式 §10.3）を返すことを手元で確認できる。ユニットテストでは
`packages/registry/src/mock.test.ts` が同じ挙動を常時検証している。

### `timeout_after_write`（AC-18-2 の再現。#49）

`timeout` はコマンドの**手前**で落ちるので、レジストリの状態は変わらず `info` も失敗する。
これでは「更新系がタイムアウトしたが、実はレジストリには届いていた」ケース
（AC-18-2 / §11.6 (d)）を手元で再現できない。

`MOCK_REGISTRY_FAIL_MODE=timeout_after_write` は**更新系だけ**を
「状態を変えてから `REGISTRY_TIMEOUT`」にし、参照系（check / info / transferQuery /
poll / hello）は通す。これで `reconcileOnTimeout`（`apps/api/src/lib/reconcile.ts`）が
参照系で結果を照合し、成功として確定する経路を実際に踏める。

例:

- `POST /domains`（**2 件目以降**）は 201。create はタイムアウトしたが `info` で存在を確認できる
- `POST /domains`（**1 件目**）は 504。先に走る `contact:create`（#72）は作成した ID を
  引く手段が無く照合できないので、`reconcileOnTimeout` の対象外。2 件目以降はコンタクトを
  使い回すのでレジストリを呼ばず、create の照合まで到達する
- `POST /domains/:name/auth-code` は 504 のまま。`info` に authInfo が含まれず照合できない
  （`docs/specs/registry-api.md` §3-15）
