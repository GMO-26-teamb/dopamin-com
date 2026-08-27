import { randomUUID } from "node:crypto";
import {
  type CDPSession,
  type Cookie,
  expect,
  type Page,
} from "@playwright/test";

/**
 * e2e 共通の WebAuthn 下ごしらえ（docs/specs/passkey-auth.md §9 / §12.5、docs/testing.md §3）。
 *
 * WebAuthn は Chromium の CDP Virtual Authenticator で肩代わりする
 * （生体認証 / PIN のダイアログは出ない）。`passkey.spec.ts`（FR-01 本体）と
 * `demo-scenario.spec.ts`（§3.3 のデモ通し）が同じ作り方を使うので、ここに 1 か所だけ置く。
 *
 * このファイルは `*.spec.ts` ではないので Playwright のテスト収集には拾われない。
 */

/** ctap2 / internal = プラットフォーム認証器。resident key + UV を持ち、presence は自動で満たす */
export const AUTHENTICATOR_OPTIONS = {
  protocol: "ctap2",
  transport: "internal",
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
} as const;

export interface VirtualAuthenticator {
  cdp: CDPSession;
  authenticatorId: string;
}

/** ページに仮想認証器を 1 台つなぐ。`page.goto()` より前に呼ぶ */
export async function attachVirtualAuthenticator(
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
export function uniqueDisplayName(): string {
  return `e2e-${randomUUID().slice(0, 8)}`;
}

/** セッション Cookie（HttpOnly なので context 経由で読む） */
export async function sessionCookie(page: Page): Promise<Cookie | undefined> {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === "dopamin_session");
}

/**
 * S-01: 表示名を入れてパスキーを作り、`/dashboard` に着くまで（AC-01-1）。
 * 呼ぶ前に {@link attachVirtualAuthenticator} を済ませておくこと。
 */
export async function signUpWithPasskey(
  page: Page,
  displayName: string,
): Promise<void> {
  await page.goto("/signup");
  await page.getByLabel("表示名").fill(displayName);
  await page.getByRole("button", { name: "パスキーを作成" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}
