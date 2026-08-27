import { randomUUID } from "node:crypto";
import {
  type CDPSession,
  type Cookie,
  expect,
  type Page,
  test,
} from "@playwright/test";

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

/** ctap2 / internal = プラットフォーム認証器。resident key + UV を持ち、presence は自動で満たす */
const AUTHENTICATOR_OPTIONS = {
  protocol: "ctap2",
  transport: "internal",
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
} as const;

interface VirtualAuthenticator {
  cdp: CDPSession;
  authenticatorId: string;
}

/** ページに仮想認証器を 1 台つなぐ。`page.goto()` より前に呼ぶ */
async function attachVirtualAuthenticator(
  page: Page,
): Promise<VirtualAuthenticator> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send(
    "WebAuthn.addVirtualAuthenticator",
    { options: AUTHENTICATOR_OPTIONS },
  );
  return { cdp, authenticatorId };
}

/** 同じ DB で何度でも流せるよう、表示名は毎回ユニークにする（1〜32 文字） */
function uniqueDisplayName(): string {
  return `e2e-${randomUUID().slice(0, 8)}`;
}

/** セッション Cookie（HttpOnly なので context 経由で読む） */
async function sessionCookie(page: Page): Promise<Cookie | undefined> {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === "dopamin_session");
}

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

  test("サインアップ → ログアウト → ログイン → パスキーの追加と削除 (AC-01-1 / AC-01-2)", async ({
    page,
  }) => {
    const displayName = uniqueDisplayName();
    const authenticator = await attachVirtualAuthenticator(page);

    // 削除ボタンは行ごとに 1 つ（aria-label「<名前> のパスキーを削除…」）。件数 = 行数として使う
    const deleteButtons = page.getByRole("button", {
      name: /のパスキーを削除/,
    });
    // 最後の 1 件だけ aria-label に「（最後の 1 つは不可）」が付く（passkey-section.tsx）
    const lastPasskeyButton = page.getByRole("button", {
      name: /最後の 1 つは不可/,
    });

    await test.step("S-01: 表示名を入れてパスキーを作成すると /dashboard に着く", async () => {
      await page.goto("/signup");
      await page.getByLabel("表示名").fill(displayName);
      await page.getByRole("button", { name: "パスキーを作成" }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      // dashboard の一覧 API は未実装で Error Card が出るが、AppShell（ナビ）が描かれていれば到達とみなす
      await expect(
        page.getByRole("navigation", { name: "メインナビゲーション" }),
      ).toBeVisible();
      expect(await sessionCookie(page)).toBeDefined();
    });

    await test.step("ログアウトすると /login に戻り、Cookie が消える", async () => {
      await page.getByRole("button", { name: "ログアウト" }).click();
      await expect(page).toHaveURL(/\/login$/);
      expect(await sessionCookie(page)).toBeUndefined();
    });

    await test.step("S-02: テキスト入力欄が無く、ボタン 1 つでログインできる (AC-01-2)", async () => {
      await expect(page.getByRole("textbox")).toHaveCount(0);
      await expect(page.locator("input, textarea")).toHaveCount(0);
      await page.getByRole("button", { name: "パスキーでログイン" }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      expect(await sessionCookie(page)).toBeDefined();
    });

    await test.step("S-70: パスキーは 1 件で、削除ボタンは Disabled", async () => {
      await page.goto("/settings");
      await expect(deleteButtons).toHaveCount(1);
      await expect(lastPasskeyButton).toBeDisabled();
    });

    await test.step("「パスキーを追加」で 2 件になる", async () => {
      // 追加登録の options は excludeCredentials に 1 件目を入れる（spec §3.3）ので、
      // 同じ認証器では InvalidStateError になる。別デバイスを模して認証器を差し替える
      await authenticator.cdp.send("WebAuthn.removeVirtualAuthenticator", {
        authenticatorId: authenticator.authenticatorId,
      });
      await authenticator.cdp.send("WebAuthn.addVirtualAuthenticator", {
        options: AUTHENTICATOR_OPTIONS,
      });
      await page.getByRole("button", { name: "パスキーを追加" }).click();
      await expect(page.getByText("パスキーを追加しました")).toBeVisible();
      await expect(deleteButtons).toHaveCount(2);
      await expect(lastPasskeyButton).toHaveCount(0);
    });

    await test.step("D-09: 1 件削除すると残り 1 件の削除ボタンが Disabled に戻る", async () => {
      // 一覧の並びは API が保証しない（listPasskeys に orderBy なし）ので、どちらを消すかは問わない
      await deleteButtons.first().click();
      const dialog = page.getByRole("dialog", {
        name: "パスキーを削除しますか？",
      });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "削除する" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText("パスキーを削除しました")).toBeVisible();
      await expect(deleteButtons).toHaveCount(1);
      await expect(lastPasskeyButton).toBeDisabled();
    });
  });
});
