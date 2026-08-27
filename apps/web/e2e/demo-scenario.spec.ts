import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  attachVirtualAuthenticator,
  signUpWithPasskey,
  uniqueDisplayName,
} from "./support/webauthn";

/**
 * デモシナリオ通し（docs/requirements.md §3.3 の 1〜5 / docs/specs/manual-checklist.md §6 の 6-1〜6-5）。
 *
 * 通す範囲:
 *   1. パスキーでサインアップ（S-01 / FR-01）
 *   2-3. 空き確認 + 独自性スコア（S-24 / FR-03・FR-05）
 *   4. 登録ダイアログ → モック決済 → 登録成功（S-25 → S-29 → S-26 / FR-06・FR-19）
 *      → ダッシュボードの保有一覧に出る（S-10 / FR-02）
 *   5. サブドメイン設計の保存と DNS 反映（S-40 → S-43 → S-44 → S-45 / FR-13）
 *
 * **外に出る経路は通さない**（CI を不安定にしないため。docs/testing.md §3）:
 *   - AI 候補生成（S-20〜S-22 / FR-04）と AI のサブドメイン提案（FR-13 の「解析」「概要から提案」）は
 *     AI プロバイダのキーが要り、キーの有無・レート制限・応答時間で結果が変わる。
 *     e2e ではデモ手順 6-2 の代わりに「自分で入力して探す」（直接検索、S-24）を使い、
 *     設計は API（`PUT /domains/:name/subdomain-plan`）で用意してから画面で編集・保存する。
 *   - GitHub のリポジトリ解析（AC-13-1）も同じ理由で通さない。
 * どちらも `apps/api` の unit / 統合テストが mock で常時検証している。
 *
 * 前提: playwright.config.ts の webServer が web（http モード）と
 * api（`REGISTRY_MODE=mock` + Postgres）を起動している。
 * passkey.spec.ts と DB を共有するので、表示名もドメイン名も毎回ユニークにする。
 */

/** デモ用に登録するドメイン。同じ DB で何度でも流せるよう毎回ユニークにする（`.com` = デモ手順 6-4） */
function uniqueDomainName(): string {
  return `e2e-demo-${randomUUID().slice(0, 8)}.com`;
}

/**
 * AI 提案の代わりに用意する設計（`PUT /domains/:name/subdomain-plan` の入力）。
 * 形は `savedSubdomainProposalSchema`（packages/shared/src/subdomains.ts）。
 * デモ手順 6-5 の `www` / `api` / `docs` に合わせる。
 */
const SEED_PLAN = {
  policy: "www / api / docs の 3 ホストで始める",
  items: [
    {
      host: "www",
      purpose: "ランディングページ",
      recordType: "CNAME",
      target: "www.dopamin-e2e.invalid",
      priority: "required",
    },
    {
      host: "api",
      purpose: "API サーバー",
      recordType: "CNAME",
      target: "api.dopamin-e2e.invalid",
      priority: "recommended",
    },
    {
      host: "docs",
      purpose: "ドキュメントサイト",
      recordType: "CNAME",
      target: "docs.dopamin-e2e.invalid",
      priority: "optional",
    },
  ],
};

test.describe("デモシナリオ（§3.3 の 1〜5）", () => {
  test("サインアップ → 空き確認とスコア → モック決済で登録 → 保有一覧 → サブドメイン設計の保存と反映", async ({
    page,
  }) => {
    // 5 画面を 1 本で通すぶん既定の 60 秒では足りないことがある（登録・保存・反映で待ちが入る）
    test.setTimeout(120_000);

    const displayName = uniqueDisplayName();
    const domain = uniqueDomainName();
    const policy = `e2e ${randomUUID().slice(0, 8)} の方針`;

    await test.step("1. パスキーでサインアップすると保有 0 件のダッシュボードに着く（S-01 / S-11）", async () => {
      await attachVirtualAuthenticator(page);
      await signUpWithPasskey(page, displayName);
      await expect(
        page.getByRole("heading", { name: "保有ドメイン" }),
      ).toBeVisible();
      await expect(page.getByText("まだドメインがありません")).toBeVisible();
    });

    await test.step("2-3. 直接検索で空きと独自性スコアが出る（S-24 / AC-03-1 / AC-05-2）", async () => {
      await page.goto("/domains/new");
      // AI 候補（S-20〜S-22）は使わない。二次導線の直接検索を開く（#218）
      await page.getByRole("button", { name: "自分で入力して探す" }).click();
      await page.getByLabel("ドメイン名（SLD）").fill(domain);
      await page.getByRole("button", { name: "空きを確認" }).click();

      // 結果カードの見出しが「空き 1」を数える = check が available で返っている
      await expect(
        page.getByText(`${domain} の空き状況 — 空き 1`),
      ).toBeVisible();

      // 独自性スコア（FR-05）は見出しに 1 つだけ出る。押すと似ている名前の内訳が開く
      const scoreToggle = page.getByRole("button", {
        name: "似ている名前を開く",
      });
      await expect(scoreToggle).toBeVisible();
      await scoreToggle.click();
      await expect(
        page.getByRole("button", { name: "似ている名前を閉じる" }),
      ).toBeVisible();
    });

    await test.step("4. 登録ダイアログ → モック決済 → 登録成功（S-25 → S-29 → S-26 / AC-19-4）", async () => {
      // 独自性が low の名前だけラベルが「それでも登録」になる（search-result-row.tsx）
      await page.getByRole("button", { name: /登録へ|それでも登録/ }).click();

      const dialog = page.getByRole("dialog", { name: `${domain} を登録` });
      await expect(dialog).toBeVisible();
      // 開いた直後の再 check（S-25）
      await expect(dialog.getByText("空き・再確認済み")).toBeVisible();

      await dialog.getByRole("button", { name: "お支払いへ" }).click();
      // S-29: デモ用カードが入った状態で開く（AC-19-4「追加入力なしで進める」）
      await expect(dialog.getByText("デモ用カード（入力済み）")).toBeVisible();
      await dialog.getByRole("button", { name: /を支払って登録する$/ }).click();

      const success = page.getByRole("dialog", { name: "取得できました" });
      await expect(success).toBeVisible();
      await expect(success.getByText(domain)).toBeVisible();
      // モック決済の控え（FR-19）が S-26 に出る
      await expect(success.getByText(/受付 pay_/)).toBeVisible();

      await success.getByRole("button", { name: "詳細を見る" }).click();
      await expect(page).toHaveURL(`/domains/${domain}`);
      await expect(
        page.getByRole("heading", { level: 1, name: domain }),
      ).toBeVisible();
    });

    await test.step("4b. 登録したドメインが保有一覧に出る（S-10 / AC-02-1）", async () => {
      await page.goto("/dashboard");
      // カードは article（aria-labelledby がドメイン名）。詳細リンクも同じカードから出る
      await expect(page.getByRole("article", { name: domain })).toBeVisible();
      await expect(
        page.getByRole("link", { name: `${domain} の詳細` }),
      ).toBeVisible();
    });

    await test.step("5. サブドメイン設計は最初 0 件（S-40）", async () => {
      await page.goto(`/domains/${domain}/subdomains`);
      await expect(
        page.getByRole("heading", { name: "サブドメイン設計" }),
      ).toBeVisible();
      await expect(
        page.getByText("リポジトリを解析して構成を提案します"),
      ).toBeVisible();
    });

    await test.step("5b. 設計を用意すると画面に読み込まれる（S-43 / AC-13-3）", async () => {
      // AI 提案（POST）はキーが要るので通さない。保存 API に直接入れて S-43 の状態を作る
      const seeded = await page.request.put(
        `/api/v1/domains/${domain}/subdomain-plan`,
        { data: SEED_PLAN },
      );
      expect(seeded.status()).toBe(200);

      await page.reload();
      for (const host of ["www", "api", "docs"]) {
        await expect(
          page.getByRole("button", { name: new RegExp(`^${host}\\b`) }),
        ).toBeVisible();
      }
      await expect(page.getByText("未切替")).toBeVisible();
    });

    await test.step("5c. 編集して保存すると再読み込み後も残る（AC-13-3）", async () => {
      await page.getByLabel("全体方針").fill(policy);
      const save = page.getByRole("button", { name: "設計を保存" });
      await expect(save).toBeEnabled();
      await save.click();
      // 保存中は「保存中…」に変わる。元のラベルに戻って Disabled = 保存済み（未編集）
      await expect(
        page.getByRole("button", { name: "設計を保存" }),
      ).toBeDisabled();

      await page.reload();
      await expect(page.getByLabel("全体方針")).toHaveValue(policy);
      await expect(page.getByRole("button", { name: /^www\b/ })).toBeVisible();
    });

    await test.step("5d. DNS に反映すると全ホストが反映済みになり NS が切り替わる（S-44 → S-45 / AC-13-4）", async () => {
      await page.getByRole("button", { name: /^DNS に反映/ }).click();

      const dialog = page.getByRole("dialog", {
        name: "DNS に反映しますか？",
      });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText("追加 3")).toBeVisible();
      await dialog.getByRole("button", { name: "反映する" }).click();
      await expect(dialog).toBeHidden();

      await expect(page.getByText("DNS に反映しました")).toBeVisible();
      await expect(page.getByText("反映済み 3・差分なし")).toBeVisible();
      await expect(page.getByText("切替済み")).toBeVisible();
    });
  });
});
