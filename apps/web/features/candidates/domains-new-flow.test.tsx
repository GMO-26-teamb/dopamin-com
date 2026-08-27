import { formatJpy, type OrderQuote, quoteOrder } from "@dopamin/shared";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DomainsNewPage from "@/app/(app)/domains/new/page";
import {
  createMockServices,
  resetMockStore,
} from "@/lib/api/mock/mock-services";
import type { MockScenario } from "@/lib/api/mock/scenario";
import { AppProviders } from "@/lib/api/query-client";
import { DECLINED_CARD_NUMBER, DEMO_CARD } from "@/lib/payments/card";
import { SUPPORTED_TLDS } from "./tlds";

/**
 * `/domains/new`（S-20〜S-28）を `?mock=` の各シナリオで通す。
 * シナリオはモックサービスを直接差し込んで再現するので、URL を触らずに済む。
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}));

/**
 * ドメイン名は SLD と TLD を別の span に分けて色を変えるので、
 * Testing Library の既定マッチャ（直下のテキストノードだけを見る）では拾えない。
 */
function domainNode(name: string): HTMLElement {
  return screen.getByText(
    (_content, element) =>
      element?.textContent === name &&
      (element as HTMLElement).className.includes("text-domain"),
  );
}

async function findDomainNode(name: string): Promise<HTMLElement> {
  return screen.findByText(
    (_content, element) =>
      element?.textContent === name &&
      (element as HTMLElement).className.includes("text-domain"),
  );
}

function renderPage(scenario: MockScenario) {
  const services = createMockServices(scenario, {
    delayMs: scenario === "loading" ? 10_000 : 0,
  });
  render(
    <AppProviders services={services}>
      <DomainsNewPage />
    </AppProviders>,
  );
  return services;
}

/** 希望 TLD の chip はどちらのフォームにもあるので、form 単位で絞り込む。 */
function formOf(label: string): HTMLElement {
  const form = screen.getByLabelText(label).closest("form");
  if (form === null) {
    throw new Error(`${label} の form が見つかりません`);
  }
  return form;
}

const CANDIDATE_FORM = "ニックネームまたはアプリ名 *";
const SEARCH_FORM = "ドメイン名（SLD）";

async function generate(scenario: MockScenario) {
  renderPage(scenario);
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText("ニックネームまたはアプリ名 *"),
    "たくたく",
  );
  await user.click(screen.getByRole("button", { name: "候補を考える" }));
  return user;
}

/** モックの check は名前から決定的に空きを決めるので、先に空きの候補を 1 件選んでおく。 */
async function firstAvailableCandidate(): Promise<string> {
  const probe = createMockServices("default", { delayMs: 0 });
  const candidates = await probe.candidates.generate({ nickname: "たくたく" });
  const names = candidates.map((c) => `${c.sld}.${c.tld}`);
  const rows = await probe.domains.check({ names });
  const available = rows.find((row) => row.availability === "available");
  if (available === undefined) {
    throw new Error("fixtures に空きの候補がありません");
  }
  return available.name;
}

beforeEach(() => {
  resetMockStore();
  push.mockClear();
});

afterEach(() => {
  resetMockStore();
});

describe("/domains/new", () => {
  it("S-20: 初期は入力パネルと案内・直接検索カードを出す", () => {
    renderPage("default");

    expect(
      screen.getByRole("heading", { name: "名前を考える" }),
    ).toBeInTheDocument();
    expect(screen.getByText("AI に候補を考えてもらう")).toBeInTheDocument();
    expect(screen.getByLabelText(SEARCH_FORM)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "空きを確認" }),
    ).toBeInTheDocument();
  });

  it("S-20 / S-24: 希望 TLD は複数選択で、既定は全対応 TLD 22 種", () => {
    renderPage("default");

    for (const label of [CANDIDATE_FORM, SEARCH_FORM]) {
      const chips = within(formOf(label)).getAllByRole("button", {
        pressed: true,
      });
      expect(chips).toHaveLength(SUPPORTED_TLDS.length);
      expect(chips).toHaveLength(22);
      expect(chips.map((chip) => chip.textContent)).toContain(".com");
    }
  });

  it("S-20: 希望 TLD を絞り込むと generate に tlds を渡す", async () => {
    const services = renderPage("default");
    const generateSpy = vi.spyOn(services.candidates, "generate");
    const user = userEvent.setup();
    const form = formOf(CANDIDATE_FORM);

    await user.click(within(form).getByRole("button", { name: "解除" }));
    await user.click(within(form).getByRole("button", { name: ".xyz" }));
    await user.type(screen.getByLabelText(CANDIDATE_FORM), "たくたく");
    await user.click(screen.getByRole("button", { name: "候補を考える" }));

    expect(generateSpy).toHaveBeenCalledWith({
      nickname: "たくたく",
      tlds: ["xyz"],
    });
  });

  it("S-20: ニックネーム未入力では送信せずバリデーションを出す", async () => {
    renderPage("default");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "候補を考える" }));

    expect(
      screen.getByText("ニックネームまたはアプリ名を入力してください"),
    ).toBeInTheDocument();
    expect(screen.getByText("AI に候補を考えてもらう")).toBeInTheDocument();
  });

  it("S-21: 生成中はボタンが「考え中…」になり Skeleton を並べる", async () => {
    await generate("loading");

    expect(screen.getByRole("button", { name: "考え中…" })).toBeDisabled();
    expect(screen.getByText(/考え中… 候補ごとに空き確認/)).toBeInTheDocument();
  });

  it("S-22: 候補 6 件を Rarity・空きバッジ付きで並べる", async () => {
    await generate("default");

    expect(await findDomainNode("dopalab.com")).toBeInTheDocument();
    expect(domainNode("tsukurun.xyz")).toBeInTheDocument();
    // 6 件目は取得済み（fixtures）
    expect(domainNode("myapp2026.net")).toBeInTheDocument();
    expect(screen.getByText("取得済み")).toBeInTheDocument();
    expect(screen.getAllByText("SSR").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "もう一回考える" }),
    ).toBeInTheDocument();
  });

  it("S-23: AI タイムアウトは origin=ai の文言で Error Card を出す", async () => {
    await generate("ai-timeout");

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText("AI が応答しませんでした"),
    ).toBeInTheDocument();
    expect(within(alert).getByText(/手入力で探せます/)).toBeInTheDocument();
    expect(
      within(alert).getByRole("button", { name: "再試行" }),
    ).toBeInTheDocument();
    // 直接検索へ誘導する（ui-screens S-23）
    expect(screen.getByLabelText("ドメイン名（SLD）")).toBeInTheDocument();
  });

  it("S-23: AI_UNAVAILABLE も同じ導線になる", async () => {
    await generate("error");

    expect(await screen.findByText("AI が利用できません")).toBeInTheDocument();
  });

  it("S-24: 直接検索は SLD × TLD を一括で並べ、部分失敗を注記する", async () => {
    renderPage("partial-failure");
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("ドメイン名（SLD）"), "takutaku");
    await user.click(screen.getByRole("button", { name: "空きを確認" }));

    expect(await findDomainNode("takutaku.com")).toBeInTheDocument();
    expect(screen.getAllByText("確認不可").length).toBeGreaterThan(0);
    expect(screen.getByText(/AC-03-2 部分失敗/)).toBeInTheDocument();
    expect(screen.getByText(/22 TLD 中 22 件を表示/)).toBeInTheDocument();
  });

  it("S-24: FQDN を入れると 1 件だけ check する", async () => {
    renderPage("default");
    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText("ドメイン名（SLD）"),
      "takutaku.online",
    );
    await user.click(screen.getByRole("button", { name: "空きを確認" }));

    expect(await findDomainNode("takutaku.online")).toBeInTheDocument();
    expect(
      screen.getByText(/takutaku\.online の空き状況 — 1 件を表示/),
    ).toBeInTheDocument();
  });

  it("S-24: 不正な入力はレジストリに送らず helper を Warn にする", async () => {
    renderPage("default");
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("ドメイン名（SLD）"), "-bad-");
    await user.click(screen.getByRole("button", { name: "空きを確認" }));

    expect(
      screen.getByText(/英数字とハイフンのみ、1〜63 文字/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/の空き状況/)).not.toBeInTheDocument();
  });

  it("S-24: TLD を絞り込むと選んだ TLD だけを check する", async () => {
    const services = renderPage("default");
    const check = vi.spyOn(services.domains, "check");
    const user = userEvent.setup();
    const form = formOf(SEARCH_FORM);

    await user.click(within(form).getByRole("button", { name: "解除" }));
    await user.click(within(form).getByRole("button", { name: ".com" }));
    await user.click(within(form).getByRole("button", { name: ".art" }));
    await user.type(screen.getByLabelText(SEARCH_FORM), "takutaku");
    await user.click(screen.getByRole("button", { name: "空きを確認" }));

    expect(check).toHaveBeenCalledWith({
      sld: "takutaku",
      tlds: ["com", "art"],
    });
    expect(await findDomainNode("takutaku.com")).toBeInTheDocument();
    expect(screen.getByText(/2 TLD 中 2 件を表示/)).toBeInTheDocument();
  });

  it("S-24: TLD を 1 つも選ばないとレジストリに送らず警告を出す", async () => {
    const services = renderPage("default");
    const check = vi.spyOn(services.domains, "check");
    const user = userEvent.setup();

    await user.click(
      within(formOf(SEARCH_FORM)).getByRole("button", { name: "解除" }),
    );
    await user.type(screen.getByLabelText(SEARCH_FORM), "takutaku");
    await user.click(screen.getByRole("button", { name: "空きを確認" }));

    expect(check).not.toHaveBeenCalled();
    expect(
      screen.getByText("TLD を 1 つ以上選んでください"),
    ).toBeInTheDocument();
  });

  it("S-24 エラー: check が落ちたら Error Card で再試行を促す", async () => {
    renderPage("error");
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(SEARCH_FORM), "takutaku");
    await user.click(screen.getByRole("button", { name: "空きを確認" }));

    await waitFor(() => {
      expect(
        screen.getByText("Kitaqsign に接続できません"),
      ).toBeInTheDocument();
    });
  });

  it("S-24 エラー: Error Card の再試行は直前と同じ条件を送り直す", async () => {
    const services = renderPage("error");
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(SEARCH_FORM), "takutaku");
    await user.click(screen.getByRole("button", { name: "空きを確認" }));

    const alert = await screen.findByRole("alert");
    const check = vi.spyOn(services.domains, "check");
    await user.click(within(alert).getByRole("button", { name: "再試行" }));

    expect(check).toHaveBeenCalledWith({
      sld: "takutaku",
      tlds: [...SUPPORTED_TLDS],
    });
  });

  it("S-25 → S-29 → S-26: お支払いを経て登録に成功すると Dialog / Success を出す", async () => {
    const name = await firstAvailableCandidate();
    const user = await generate("default");

    const card = (await findDomainNode(name)).closest("li");
    expect(card).not.toBeNull();
    await user.click(
      within(card as HTMLElement).getByRole("button", { name: "登録へ" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(`${name} を登録`)).toBeInTheDocument();
    await within(dialog).findByText("空き・再確認済み");

    // NS 欄は表示だけで送信しない。実際には適用されない既定 NS を出さない（#173）
    expect(
      within(dialog).getByText(
        "登録時は未設定。あとから「情報修正」で設定できます",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/ns1\.dopamin/)).toBeNull();

    // S-25 は期間選択まで。決済はまだ通っていない（AC-19-1）
    await user.click(
      within(dialog).getByRole("button", { name: "お支払いへ" }),
    );

    // S-29 お支払い: 注文サマリー（1 年 = 単価）とデモ用カードが入っている（AC-19-4）
    const payment = await screen.findByRole("dialog");
    expect(within(payment).getByText("ご注文内容")).toBeInTheDocument();
    const quote = quoteOrder({ kind: "register", domain: name, years: 1 });
    expect(quote).not.toBeNull();
    expect(within(payment).getByTestId("order-total")).toHaveTextContent(
      formatJpy((quote as OrderQuote).total),
    );
    expect(within(payment).getByLabelText("カード番号")).toHaveValue(
      DEMO_CARD.number,
    );

    await user.click(
      within(payment).getByRole("button", {
        name: `${formatJpy((quote as OrderQuote).total)} を支払って登録する`,
      }),
    );

    expect(await screen.findByText("取得できました")).toBeInTheDocument();
    expect(
      screen.getByText(
        new RegExp(`お支払い ${formatJpy((quote as OrderQuote).total)}`),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "サブドメイン設計に進む" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "詳細を見る" }));
    expect(push).toHaveBeenCalledWith(`/domains/${name}`);
  });

  it("S-29: 決済が拒否されたら登録は呼ばれず、ダイアログ内に理由が出る（AC-19-3）", async () => {
    const name = await firstAvailableCandidate();
    const register = vi.fn(() =>
      Promise.reject(new Error("呼ばれてはいけない")),
    );
    const services = createMockServices("default", { delayMs: 0 });
    render(
      <AppProviders
        services={{
          ...services,
          domains: { ...services.domains, register },
        }}
      >
        <DomainsNewPage />
      </AppProviders>,
    );
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("ニックネームまたはアプリ名 *"),
      "たくたく",
    );
    await user.click(screen.getByRole("button", { name: "候補を考える" }));

    const card = (await findDomainNode(name)).closest("li");
    await user.click(
      within(card as HTMLElement).getByRole("button", { name: "登録へ" }),
    );
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("空き・再確認済み");
    await user.click(
      within(dialog).getByRole("button", { name: "お支払いへ" }),
    );

    const payment = await screen.findByRole("dialog");
    const numberInput = within(payment).getByLabelText("カード番号");
    await user.clear(numberInput);
    await user.type(numberInput, DECLINED_CARD_NUMBER);
    await user.click(
      within(payment).getByRole("button", { name: /を支払って登録する/ }),
    );

    expect(
      await within(payment).findByText("お支払いに失敗しました"),
    ).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
    // ダイアログは開いたままで、やり直せる
    expect(
      within(payment).getByRole("button", { name: /を支払って登録する/ }),
    ).toBeInTheDocument();
  });

  it("S-29: 「戻る」で期間選択（S-25）に戻れる", async () => {
    const name = await firstAvailableCandidate();
    const user = await generate("default");

    const card = (await findDomainNode(name)).closest("li");
    await user.click(
      within(card as HTMLElement).getByRole("button", { name: "登録へ" }),
    );
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("空き・再確認済み");
    await user.click(
      within(dialog).getByRole("button", { name: "お支払いへ" }),
    );
    await within(dialog).findByText("ご注文内容");

    await user.click(within(dialog).getByRole("button", { name: "戻る" }));
    expect(within(dialog).getByLabelText("期間 *")).toBeInTheDocument();
    expect(within(dialog).queryByText("ご注文内容")).toBeNull();
  });

  it("S-27: CONFLICT は代替候補付きのダイアログになる", async () => {
    const name = await firstAvailableCandidate();
    const user = await generate("conflict");

    const card = (await findDomainNode(name)).closest("li");
    await user.click(
      within(card as HTMLElement).getByRole("button", { name: "登録へ" }),
    );
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("空き・再確認済み");
    await user.click(
      within(dialog).getByRole("button", { name: "お支払いへ" }),
    );
    await within(dialog).findByText("ご注文内容");
    await user.click(
      within(dialog).getByRole("button", { name: /を支払って登録する/ }),
    );

    expect(
      await screen.findByText(`${name} は取得できませんでした`),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "代替候補を見る" }),
    ).toBeInTheDocument();
  });

  it("unsupported シナリオでも S-20 は通常どおり出る", () => {
    renderPage("unsupported");

    expect(screen.getByText("AI に候補を考えてもらう")).toBeInTheDocument();
  });
});
