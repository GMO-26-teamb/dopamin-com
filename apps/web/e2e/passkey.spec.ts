import { expect, test } from "@playwright/test";

/**
 * FR-01 パスキー認証の e2e（docs/specs/passkey-auth.md §9 / §12.5）。
 *
 * WebAuthn は Chromium の CDP Virtual Authenticator で肩代わりする（生体認証 / PIN のダイアログは出ない）。
 * locator は docs/specs/ui-screens.md の S-01 / S-02 / S-70 / D-09 と、
 * features/auth/*.tsx・features/settings/passkey-section.tsx・components/app/sidebar.tsx の文言に合わせる。
 *
 * 前提: `pnpm --filter @dopamin/web e2e` が playwright.config.ts の webServer で
 * web（http モード）と api（mock レジストリ + Postgres）を起動している。
 */

test.describe("FR-01 パスキー認証", () => {
  test("未認証で /dashboard に直アクセスすると /login?next= へ戻され、API は 401 を返す (AC-01-3)", async ({
    page,
  }) => {
    // 各テストは新しい context（Cookie なし）で始まる。
    // proxy.ts のリダイレクトは http モードでしか動かないので、ここが素通りしたら
    // web が mock モードで起動している（pnpm dev を reuseExistingServer が掴んだ等）。
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
    await expect(
      page.getByRole("button", { name: "パスキーでログイン" }),
    ).toBeVisible();

    // API 側も 401（§10.3 UNAUTHORIZED）
    const res = await page.request.get("/api/v1/auth/me");
    expect(res.status()).toBe(401);
    expect(await res.json()).toMatchObject({
      error: { code: "UNAUTHORIZED" },
    });
  });
});
