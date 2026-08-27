import { formatJpy, type OrderQuote, quoteOrder } from "@dopamin/shared";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api/errors";
import { MOCK_NOW } from "@/lib/api/mock/fixtures";
import { createMockServices } from "@/lib/api/mock/mock-services";
import type { MockScenario } from "@/lib/api/mock/scenario";
import { resetMockStore } from "@/lib/api/mock/store";
import { AppProviders } from "@/lib/api/query-client";
import type { DomainService, Services } from "@/lib/api/services";
import { DECLINED_CARD_NUMBER } from "@/lib/payments/card";
import { ThemeProvider } from "@/lib/theme/theme-provider";
import { DomainDetailPage } from "./domain-detail-page";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/domains/takutaku.com",
}));

function renderPage(
  name: string,
  scenario: MockScenario = "default",
  domainOverrides: Partial<DomainService> = {},
  transferOverrides: Partial<Services["transfers"]> = {},
) {
  // 遅延 0ms で全状態を待たずに検証する（scenario ごとの挙動は mock-services が持つ）
  const base = createMockServices(scenario, { delayMs: 0 });
  const services: Services = {
    ...base,
    domains: { ...base.domains, ...domainOverrides },
    transfers: { ...base.transfers, ...transferOverrides },
  };
  return render(
    <ThemeProvider>
      <AppProviders services={services}>
        <DomainDetailPage name={name} />
      </AppProviders>
    </ThemeProvider>,
  );
}

/**
 * D-01（期間）→ D-11（お支払い）を既定のデモ用カードで通し、renew まで進める。
 * 決済モックは FR-19 で挟まったステップなので、renew 側の分岐を見るテストはここを共通化する。
 */
async function payThroughRenewDialog(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "お支払いへ" }));
  await user.click(
    within(dialog).getByRole("button", { name: /を支払って延長する/ }),
  );
}

/** 操作パネル（Card kicker「操作」）。 */
function actionsPanel(): HTMLElement {
  const heading = screen.getByText("操作");
  const panel = heading.parentElement;
  if (panel === null) {
    throw new Error("操作パネルが見つかりません");
  }
  return panel;
}

describe("DomainDetailPage", () => {
  beforeEach(() => {
    // fixtures は固定基準 MOCK_NOW からの相対で作られる（`tkt-lab.net` の
    // `actByAt` は MOCK_NOW + 15 分）。実時刻のままだと 10:15 JST を過ぎた瞬間に
    // 承認 / 拒否が Disabled になり落ちるので、Date だけ MOCK_NOW に固定する。
    // タイマー本体は実物のまま（`useCountdown` の setInterval と Testing Library の
    // waitFor をそのまま動かすため）。
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(MOCK_NOW));
    resetMockStore();
    push.mockReset();
  });

  afterEach(() => {
    resetMockStore();
    vi.useRealTimers();
  });

  it("S-35: 取得中は Skeleton を出す", () => {
    const { container } = renderPage("takutaku.com");
    expect(
      container.querySelector('[data-testid="detail-skeleton"]'),
    ).not.toBeNull();
  });

  it("S-30: Active はヘッダー・基本情報・操作パネルを出す", async () => {
    renderPage("takutaku.com");

    expect(
      await screen.findByRole("heading", { name: "takutaku.com" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Kitaqsign")).toBeInTheDocument();
    expect(screen.getByText("基本情報")).toBeInTheDocument();

    const panel = actionsPanel();
    expect(
      within(panel).getByRole("button", { name: "有効期限を延長" }),
    ).toBeEnabled();
    expect(
      within(panel).getByRole("button", { name: "情報修正" }),
    ).toBeEnabled();
    // Active では復旧という操作自体が無いので、Disabled でも出さない
    expect(within(panel).queryByRole("button", { name: "復旧" })).toBeNull();
    expect(within(panel).queryByText("RGP ではないため不可")).toBeNull();
  });

  it("S-30: サブドメイン設計は件数を出し、カード全体がリンクになる（#217）", async () => {
    renderPage("takutaku.com");

    expect(
      await screen.findByText("4 ホスト · 反映済み 2/4"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /開く/ })).toHaveAttribute(
      "href",
      "/domains/takutaku.com/subdomains",
    );
  });

  it("S-31: ?mock=stale は Banner Warn を出し、全操作を Disabled にする", async () => {
    renderPage("takutaku.com", "stale");

    expect(await screen.findByText("キャッシュを表示中")).toBeInTheDocument();
    const panel = actionsPanel();
    for (const label of [
      "有効期限を延長",
      "情報修正",
      "他社へ移管する",
      "廃止",
    ]) {
      expect(within(panel).getByRole("button", { name: label })).toBeDisabled();
    }
    // 理由はラベルに連結せず、ボタンの下に別の行として出す
    expect(within(panel).getAllByText("再同期が必要")).toHaveLength(4);
  });

  it("S-32: 移管申請の受信は承認 / 拒否とカウントダウンを出し、他操作を止める", async () => {
    renderPage("tkt-lab.net");

    expect(await screen.findByText("移管申請を受信")).toBeInTheDocument();
    expect(screen.getByText("移管中（申請受信）")).toBeInTheDocument();

    const panel = actionsPanel();
    await waitFor(() => {
      expect(within(panel).getByRole("button", { name: "承認" })).toBeEnabled();
    });
    expect(within(panel).getByRole("button", { name: "拒否" })).toBeEnabled();
    // カウントダウンはボタンの隣（操作パネル）だけに出す
    expect(
      within(panel).getByText(/自動承認まで \d+:\d{2}/),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/自動承認まで \d+:\d{2}/)).toHaveLength(1);
    expect(
      within(panel).getByRole("button", { name: "有効期限を延長" }),
    ).toBeDisabled();
  });

  it("S-32: /transfers が落ちても再取得から承認 / 拒否に進める（#212）", async () => {
    const user = userEvent.setup();
    const base = createMockServices("default", { delayMs: 0 });
    let failing = true;
    const list = vi.fn(() =>
      failing
        ? Promise.reject(
            new ApiClientError({
              code: "INTERNAL",
              message: "移管一覧を取得できませんでした。",
              // 自動再試行に入ると「取得中…」のままになるので、この検証では 1 回で確定させる
              retryable: false,
            }),
          )
        : base.transfers.list(),
    );
    renderPage("tkt-lab.net", "default", {}, { list });

    // 受信中であることは詳細だけで分かるので、状態と理由は必ず出る
    expect(await screen.findByText("移管申請を受信")).toBeInTheDocument();
    const panel = actionsPanel();
    await waitFor(() => {
      expect(
        within(panel).getByText("申請の内容をまだ取得できていません。"),
      ).toBeInTheDocument();
    });
    expect(within(panel).getByRole("button", { name: "承認" })).toBeDisabled();

    // 再取得が通れば、詳細画面から応答できるようになる
    failing = false;
    await user.click(within(panel).getByRole("button", { name: "申請を取得" }));
    await waitFor(() => {
      expect(within(panel).getByRole("button", { name: "承認" })).toBeEnabled();
    });
    expect(
      within(panel).queryByText("申請の内容をまだ取得できていません。"),
    ).toBeNull();
  }, 20_000);

  it("S-33: RGP は Banner Info と「復旧」だけ有効", async () => {
    renderPage("demo-app.online");

    expect(await screen.findByText("復旧猶予（RGP）中")).toBeInTheDocument();
    // 猶予期限（fixtures は 18 日後）から残日数を出す。0 日と丸めない（#211）
    expect(
      screen.getByText(
        "残り 18 日。「復旧」で Active に戻せます。期間を過ぎると完全に削除されます。",
      ),
    ).toBeInTheDocument();
    const panel = actionsPanel();
    expect(within(panel).getByRole("button", { name: "復旧" })).toBeEnabled();
    expect(
      within(panel).getByRole("button", { name: "有効期限を延長" }),
    ).toBeDisabled();
  });

  it("S-33: 猶予期限が分からないときは残日数を出さない（#211）", async () => {
    const base = createMockServices("default", { delayMs: 0 });
    const get = vi.fn(async (name: string) => ({
      ...(await base.domains.get(name)),
      rgpUntil: null,
    }));
    renderPage("demo-app.online", "default", { get });

    expect(await screen.findByText("復旧猶予（RGP）中")).toBeInTheDocument();
    expect(
      screen.getByText(
        "「復旧」で Active に戻せます。期間を過ぎると完全に削除されます。",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/残り \d+ 日/)).toBeNull();
  });

  it("S-34: 移管済みは操作パネルを出さない", async () => {
    renderPage("old-blog.xyz");

    expect(await screen.findByText("記録として表示中")).toBeInTheDocument();
    expect(screen.getByText("移管済み")).toBeInTheDocument();
    expect(screen.queryByText("操作")).toBeNull();
  });

  it("S-36: 削除待ちは操作パネルを出さず復旧も出さない（AC-11-2）", async () => {
    renderPage("pending-delete.example");

    expect(await screen.findByText("完全削除の処理中")).toBeInTheDocument();
    expect(screen.getByText(/^残り \d+ 日。/)).toBeInTheDocument();
    expect(screen.queryByText("操作")).toBeNull();
    expect(screen.queryByRole("button", { name: "復旧" })).toBeNull();
  });

  it("S-37: 停止中は Banner Warn を出しつつ更新・情報修正は可能", async () => {
    renderPage("hold.example");

    expect(
      await screen.findByText("停止中（名前解決されません）"),
    ).toBeInTheDocument();
    const panel = actionsPanel();
    expect(
      within(panel).getByRole("button", { name: "有効期限を延長" }),
    ).toBeEnabled();
    expect(
      within(panel).getByRole("button", { name: "情報修正" }),
    ).toBeEnabled();
  });

  it("S-38: NS 未設定は CTA 付き Banner と「—（未設定）」を出す", async () => {
    renderPage("inactive.example");

    expect(await screen.findByText("ネームサーバー未設定")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "NS を設定" }),
    ).toBeInTheDocument();
    expect(screen.getByText("—（未設定）")).toBeInTheDocument();
  });

  it("S-39: コンタクト未移行は Banner Warn と「情報修正」CTA を出す", async () => {
    renderPage("harupika.xyz");

    expect(await screen.findByText("登録者情報が未移行")).toBeInTheDocument();
    expect(screen.getByText("未移行")).toBeInTheDocument();
    // 直し方はカードの中にも置く（バナーまで戻らなくていい）
    expect(
      screen.getByRole("button", { name: "登録者情報を変更" }),
    ).toBeInTheDocument();
  });

  it("?mock=error は Error Card と再試行を出す", async () => {
    renderPage("takutaku.com", "error");

    expect(
      // 参照系は retryable を 2 回まで自動再試行する（1s + 2s のバックオフ）ので長めに待つ
      await screen.findByText("Kitaqsign に接続できません", undefined, {
        timeout: 15_000,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
  }, 25_000);

  it("D-01 → D-11: お支払いを経て延長すると Banner Ok が出る（AC-19-2）", async () => {
    const user = userEvent.setup();
    renderPage("takutaku.com");

    await user.click(
      await screen.findByRole("button", { name: "有効期限を延長" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("有効期限を延長")).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "お支払いへ" }),
    );

    const quote = quoteOrder({
      kind: "renew",
      domain: "takutaku.com",
      years: 1,
    });
    expect(quote).not.toBeNull();
    expect(within(dialog).getByText("ご注文内容")).toBeInTheDocument();
    expect(within(dialog).getByTestId("order-total")).toHaveTextContent(
      formatJpy((quote as OrderQuote).total),
    );
    await user.click(
      within(dialog).getByRole("button", { name: /を支払って延長する/ }),
    );

    expect(
      await screen.findByText(
        new RegExp(
          `takutaku.com の有効期限を延長しました（お支払い ${formatJpy((quote as OrderQuote).total)}`,
        ),
      ),
    ).toBeInTheDocument();
  });

  it("D-11: 決済が拒否されたら renew は呼ばれない（AC-19-3）", async () => {
    const user = userEvent.setup();
    const renew = vi.fn(() => Promise.reject(new Error("呼ばれてはいけない")));
    renderPage("takutaku.com", "default", { renew });

    await user.click(
      await screen.findByRole("button", { name: "有効期限を延長" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "お支払いへ" }),
    );

    const numberInput = within(dialog).getByLabelText("カード番号");
    await user.clear(numberInput);
    await user.type(numberInput, DECLINED_CARD_NUMBER);
    await user.click(
      within(dialog).getByRole("button", { name: /を支払って延長する/ }),
    );

    expect(
      await within(dialog).findByText("お支払いに失敗しました"),
    ).toBeInTheDocument();
    expect(renew).not.toHaveBeenCalled();
  });

  it("D-03: 廃止ダイアログはドメイン名が一致するまで実行できない", async () => {
    const user = userEvent.setup();
    renderPage("takutaku.com");

    await user.click(await screen.findByRole("button", { name: "廃止" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("takutaku.com を廃止しますか？"),
    ).toBeInTheDocument();

    const submit = within(dialog).getByRole("button", { name: "廃止する" });
    expect(submit).toBeDisabled();

    await user.type(within(dialog).getByRole("textbox"), "takutaku.com");
    expect(submit).toBeEnabled();

    await user.click(submit);
    expect(
      await screen.findByText(/を廃止しました。復旧猶予（RGP）に入りました/),
    ).toBeInTheDocument();
  });

  it("D-05: AuthCode は開くと発行され、再発行で値が変わる", async () => {
    const user = userEvent.setup();
    renderPage("takutaku.com");

    await user.click(
      await screen.findByRole("button", { name: "他社へ移管する" }),
    );
    const dialog = await screen.findByRole("dialog");
    const first = await within(dialog).findByText(/^MOCK-TAKUTAKU-\d+$/);
    const firstCode = first.textContent;

    await user.click(within(dialog).getByRole("button", { name: "再発行" }));
    await waitFor(() => {
      expect(
        within(dialog).getByText(/^MOCK-TAKUTAKU-\d+$/).textContent,
      ).not.toBe(firstCode);
    });
  });

  it("D-06: 承認はドメイン名の再入力で解錠され、成功すると移管済みになる", async () => {
    const user = userEvent.setup();
    renderPage("tkt-lab.net");

    const panel = await waitFor(() => actionsPanel());
    await waitFor(() => {
      expect(within(panel).getByRole("button", { name: "承認" })).toBeEnabled();
    });
    await user.click(within(panel).getByRole("button", { name: "承認" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("tkt-lab.net の移管を承認しますか？"),
    ).toBeInTheDocument();
    const submit = within(dialog).getByRole("button", { name: "承認する" });
    expect(submit).toBeDisabled();

    await user.type(within(dialog).getByRole("textbox"), "tkt-lab.net");
    await user.click(submit);

    expect(
      await screen.findByText("tkt-lab.net の移管を承認しました"),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("移管済み")).toBeInTheDocument();
    });
  });

  it("D-07: 更新の失敗は Error Card を出し、「再試行」で D-01 を開き直す", async () => {
    const user = userEvent.setup();
    const renew = vi.fn(() =>
      Promise.reject(
        new ApiClientError({
          code: "REGISTRY_TIMEOUT",
          message: "レジストリが応答しませんでした。",
          registry: "kitaqsign",
        }),
      ),
    );
    renderPage("takutaku.com", "default", { renew });

    await user.click(
      await screen.findByRole("button", { name: "有効期限を延長" }),
    );
    await payThroughRenewDialog(user);

    // ダイアログは閉じ、メイン先頭に Error Card（FR-18 の 1 文つき）
    expect(
      await screen.findByText("Kitaqsign が応答しませんでした"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ローカルの情報は変更されていません/),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    // 「再試行」はエラーを消すだけでなく D-01 を開き直す
    await user.click(screen.getByRole("button", { name: "再試行" }));
    const reopened = await screen.findByRole("dialog");
    expect(within(reopened).getByText("有効期限を延長")).toBeInTheDocument();
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it("D-07: 再試行できないコードは「閉じる」で Error Card を畳む", async () => {
    const user = userEvent.setup();
    const renew = vi.fn(() =>
      Promise.reject(
        new ApiClientError({
          code: "OPERATION_NOT_ALLOWED",
          message: "",
          details: { statuses: ["serverUpdateProhibited"] },
        }),
      ),
    );
    renderPage("takutaku.com", "default", { renew });

    await user.click(
      await screen.findByRole("button", { name: "有効期限を延長" }),
    );
    await payThroughRenewDialog(user);

    expect(
      await screen.findByText("ロック中のため実行できません"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "再試行" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "閉じる" }));
    await waitFor(() => {
      expect(screen.queryByText("ロック中のため実行できません")).toBeNull();
    });
  });

  it("FORBIDDEN / NOT_FOUND は S-80 と同じ案内を出す", async () => {
    renderPage("unknown.example");

    expect(
      await screen.findByText("ページが見つかりません"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "ダッシュボードへ" }),
    ).toHaveAttribute("href", "/dashboard");
  });
});
