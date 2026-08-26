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

## 3. e2e（Playwright + CDP Virtual Authenticator、FR-01）

`apps/web/e2e/passkey.spec.ts` が、実ブラウザ（Chromium）でサインアップ → ログアウト → ログイン →
パスキーの追加 / 削除 → 未認証リダイレクト（AC-01-1〜3）を通しで検証する。WebAuthn の生体認証は
CDP の `WebAuthn.addVirtualAuthenticator` で肩代わりするので、ダイアログは出ない。

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
- ポート 3000 / 8787 で `pnpm dev` が動いていると `reuseExistingServer` がそれを掴む。mock モードの web だと
  最初のテスト（AC-01-3 のリダイレクト）が失敗するので、`pnpm dev` を止めてから実行する。
  逆に e2e が起動した web / api は次回の実行で再利用されるので、2 回目以降は `next build` を待たずに済む。
- DB の接続先は環境変数 `DATABASE_URL`（未設定なら上の docker の 54329）。表示名は毎回ユニークにしているので、
  同じ DB で繰り返し実行できる。
- `next build` は `next/font/google` のフォント取得でネットワークを使う。
- CI は `.github/workflows/ci.yml` の `e2e` ジョブ（`services: postgres`）。`continue-on-error: true` で必須にはしていない。
  失敗時は `playwright-report` アーティファクトにトレース / スクリーンショットが残る。
- turbo の `test` には含めない（`pnpm test` / `pnpm check` は e2e を走らせない）。

## 4. mock レジストリのエラーシミュレーション（§11.6）

`apps/api/.env.local` で `REGISTRY_MODE=mock` のまま `MOCK_REGISTRY_FAIL_MODE` を
`timeout` / `5xx` / `reject` / `spec_mismatch` に切り替えると、API がエラー応答
（統一エラー形式 §10.3）を返すことを手元で確認できる。ユニットテストでは
`packages/registry/src/mock.test.ts` が同じ挙動を常時検証している。
