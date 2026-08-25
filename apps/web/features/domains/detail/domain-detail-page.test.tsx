import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockServices } from "@/lib/api/mock/mock-services";
import type { MockScenario } from "@/lib/api/mock/scenario";
import { resetMockStore } from "@/lib/api/mock/store";
import { AppProviders } from "@/lib/api/query-client";
import { ThemeProvider } from "@/lib/theme/theme-provider";
import { DomainDetailPage } from "./domain-detail-page";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/domains/takutaku.com",
}));

function renderPage(name: string, scenario: MockScenario = "default") {
  // 遅延 0ms で全状態を待たずに検証する（scenario ごとの挙動は mock-services が持つ）
  const services = createMockServices(scenario, { delayMs: 0 });
  return render(
    <ThemeProvider>
      <AppProviders services={services}>
        <DomainDetailPage name={name} />
      </AppProviders>
    </ThemeProvider>,
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
    resetMockStore();
    push.mockReset();
  });

  afterEach(() => {
    resetMockStore();
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
    expect(screen.getByText("kitaqsign")).toBeInTheDocument();
    expect(screen.getByText("基本情報")).toBeInTheDocument();

    const panel = actionsPanel();
    expect(
      within(panel).getByRole("button", { name: /更新（期限延長）/ }),
    ).toBeEnabled();
    expect(
      within(panel).getByRole("button", { name: /情報修正（NS・コンタクト）/ }),
    ).toBeEnabled();
    // 復旧は RGP ではないので不可（理由つき）
    expect(
      within(panel).getByRole("button", {
        name: "復旧 — RGP ではないため不可",
      }),
    ).toBeDisabled();
  });

  it("S-31: ?mock=stale は Banner Warn を出し、全操作を Disabled にする", async () => {
    renderPage("takutaku.com", "stale");

    expect(
      await screen.findByText("最新の状態を取得できませんでした"),
    ).toBeInTheDocument();
    const panel = actionsPanel();
    for (const label of [
      /更新（期限延長）/,
      /情報修正/,
      /移管OUT/,
      /廃止/,
      /復旧/,
    ]) {
      expect(within(panel).getByRole("button", { name: label })).toBeDisabled();
    }
  });

  it("S-32: 移管申請の受信は承認 / 拒否とカウントダウンを出し、他操作を止める", async () => {
    renderPage("tkt-lab.net");

    expect(
      await screen.findByText("相手レジストラから移管申請を受信しました"),
    ).toBeInTheDocument();
    expect(screen.getByText("移管中（申請受信）")).toBeInTheDocument();

    const panel = actionsPanel();
    await waitFor(() => {
      expect(within(panel).getByRole("button", { name: "承認" })).toBeEnabled();
    });
    expect(within(panel).getByRole("button", { name: "拒否" })).toBeEnabled();
    expect(
      within(panel).getByText(/自動承認まで \d+:\d{2}/),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: /更新（期限延長）/ }),
    ).toBeDisabled();
  });

  it("S-33: RGP は Banner Info と「復旧」だけ有効", async () => {
    renderPage("demo-app.online");

    expect(
      await screen.findByText("復旧猶予（RGP）期間中です"),
    ).toBeInTheDocument();
    const panel = actionsPanel();
    expect(within(panel).getByRole("button", { name: "復旧" })).toBeEnabled();
    expect(
      within(panel).getByRole("button", { name: /更新（期限延長）/ }),
    ).toBeDisabled();
  });

  it("S-34: 移管済みは操作パネルを出さない", async () => {
    renderPage("old-blog.xyz");

    expect(await screen.findByText("表示のみ")).toBeInTheDocument();
    expect(screen.getByText("移管済み")).toBeInTheDocument();
    expect(screen.queryByText("操作")).toBeNull();
  });

  it("S-36: 削除待ちは操作パネルを出さず復旧も出さない（AC-11-2）", async () => {
    renderPage("pending-delete.example");

    expect(
      await screen.findByText(/完全削除まで残り \d+ 日/),
    ).toBeInTheDocument();
    expect(screen.queryByText("操作")).toBeNull();
    expect(screen.queryByRole("button", { name: "復旧" })).toBeNull();
  });

  it("S-37: 停止中は Banner Warn を出しつつ更新・情報修正は可能", async () => {
    renderPage("hold.example");

    expect(
      await screen.findByText("名前解決されません。運営の案内を確認"),
    ).toBeInTheDocument();
    const panel = actionsPanel();
    expect(
      within(panel).getByRole("button", { name: /更新（期限延長）/ }),
    ).toBeEnabled();
    expect(
      within(panel).getByRole("button", { name: /情報修正/ }),
    ).toBeEnabled();
  });

  it("S-38: NS 未設定は CTA 付き Banner と「—（未設定）」を出す", async () => {
    renderPage("inactive.example");

    expect(
      await screen.findByText("ネームサーバーを設定してください"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "NS を設定" }),
    ).toBeInTheDocument();
    expect(screen.getByText("—（未設定）")).toBeInTheDocument();
  });

  it("S-39: コンタクト未移行は Banner Warn と「情報修正」CTA を出す", async () => {
    renderPage("harupika.xyz");

    expect(
      await screen.findByText("登録者情報が旧レジストラのままです"),
    ).toBeInTheDocument();
    expect(screen.getByText("未移行")).toBeInTheDocument();
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

  it("D-01: 更新ダイアログで延長すると Banner Ok が出る", async () => {
    const user = userEvent.setup();
    renderPage("takutaku.com");

    await user.click(
      await screen.findByRole("button", { name: /更新（期限延長）/ }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("有効期限を延長")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "延長する" }));

    expect(
      await screen.findByText("takutaku.com の有効期限を延長しました"),
    ).toBeInTheDocument();
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
      await screen.findByRole("button", { name: /移管OUT — AuthCode表示/ }),
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
