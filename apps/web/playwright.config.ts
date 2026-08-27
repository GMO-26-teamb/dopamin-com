import { defineConfig, devices } from "@playwright/test";

/**
 * FR-01 の e2e（docs/specs/passkey-auth.md §9 / §12.5、docs/testing.md §3）。
 *
 * web（:3000, `NEXT_PUBLIC_API_MODE=http`）と api（:8787, `REGISTRY_MODE=mock` + Postgres）を
 * `webServer` から起動する。WebAuthn の RP ID は `localhost` 固定なので baseURL も必ず
 * `http://localhost:3000`（`127.0.0.1` では RP ID 不一致で失敗する。spec §6）。
 *
 * web は `next dev` ではなく `next build && next start` で起動する:
 * - dev はルートごとのオンデマンドコンパイルで初回遷移が数秒〜十数秒かかり、待ち時間が揺れる
 * - dev のエラーオーバーレイがクリックを奪うことがある
 * - `next dev` は apps/web/AGENTS.md を書き換えて作業ツリーを汚す
 * - proxy.ts / rewrites を本番と同じ経路で検証できる
 * 代わりにビルド分（ローカル 1〜2 分）だけ起動が遅いので `timeout` を長めに取る。
 */

const isCi = Boolean(process.env.CI);

/**
 * api に渡す DB 接続先（docs/testing.md §3）。
 * - CI: `.github/workflows/ci.yml` の e2e ジョブが `services: postgres` を `DATABASE_URL` で渡す（必須）。
 * - ローカル: `E2E_DATABASE_URL`（未設定なら docker の postgres:17 / 54329）。
 *   シェルの `DATABASE_URL` は `pnpm dev` 用に Supabase を指していることがあるので、e2e の
 *   signup / パスキー追加・削除が共有 DB に書き込まないよう **読まない**。
 */
function resolveDatabaseUrl(): string {
  if (isCi) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "CI では DATABASE_URL が必須です（ci.yml の e2e ジョブが services: postgres を渡す）",
      );
    }
    return url;
  }
  return (
    process.env.E2E_DATABASE_URL ??
    "postgres://postgres:postgres@localhost:54329/postgres"
  );
}

const DATABASE_URL = resolveDatabaseUrl();

const WEB_ORIGIN = "http://localhost:3000";
const API_ORIGIN = "http://localhost:8787";

export default defineConfig({
  testDir: "./e2e",
  // 1 つの DB と 1 組のサーバーを共有するので直列に走らせる
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: isCi ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: WEB_ORIGIN,
    locale: "ja-JP",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // apps/api/package.json の dev と同じ入口。`.env.local` は読まない（接続先を env で固定するため）。
      // 既存の :8787 は再利用しない: `pnpm dev` の api は .env.local（Supabase / 実レジストリ）を読んでいる
      // 可能性があり、それを掴むと signup / パスキー追加・削除が共有 DB に書き込んでしまう。
      // tsx の起動は数秒なので再利用の利点もない。ポート使用中なら Playwright が即失敗する（安全側）。
      command: "pnpm --filter @dopamin/api exec tsx src/dev.ts",
      url: `${API_ORIGIN}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: "8787",
        REGISTRY_MODE: "mock",
        DATABASE_URL,
        WEBAUTHN_RP_ID: "localhost",
        WEBAUTHN_ORIGIN: WEB_ORIGIN,
        WEBAUTHN_RP_NAME: "ドパ民.com (e2e)",
      },
    },
    {
      // NEXT_PUBLIC_API_MODE はビルド時定数（apps/web/lib/api/mode.ts）なので build にも渡す。
      // Next は既に設定済みの環境変数を .env.local で上書きしないため、
      // 開発者の .env.local に NEXT_PUBLIC_API_MODE=mock があってもここが勝つ。
      command: "pnpm exec next build && pnpm exec next start --port 3000",
      url: `${WEB_ORIGIN}/login`,
      reuseExistingServer: !isCi,
      timeout: 300_000,
      env: {
        NEXT_PUBLIC_API_MODE: "http",
        API_ORIGIN,
      },
    },
  ],
});
