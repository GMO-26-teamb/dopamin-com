import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/lib/theme/theme-provider";
import { activeNavKey, Sidebar, type SidebarNavKey } from "./sidebar";

function renderSidebar(active?: SidebarNavKey, onLogout = vi.fn()) {
  render(
    <ThemeProvider>
      <Sidebar active={active} onLogout={onLogout} userName="たくたく" />
    </ThemeProvider>,
  );
  return { onLogout };
}

describe("Sidebar", () => {
  it("5 つのナビ項目をそれぞれの href で並べる", () => {
    renderSidebar("dashboard");

    const nav = screen.getByRole("navigation", {
      name: "メインナビゲーション",
    });
    const links = within(nav).getAllByRole("link");

    expect(links.map((link) => link.textContent)).toEqual([
      "ダッシュボード",
      "ドメイン取得",
      "移管",
      "設定",
      "ログ",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/dashboard",
      "/domains/new",
      "/transfers",
      "/settings",
      "/logs",
    ]);
  });

  it("active のナビ項目にだけ aria-current=page が付く", () => {
    renderSidebar("transfers");

    expect(screen.getByRole("link", { name: "移管" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const name of ["ダッシュボード", "ドメイン取得", "設定", "ログ"]) {
      expect(screen.getByRole("link", { name })).not.toHaveAttribute(
        "aria-current",
      );
    }
  });

  it("主要 CTA は /domains/new へのリンク", () => {
    renderSidebar("dashboard");

    expect(
      screen.getByRole("link", { name: "ドメインを取得" }),
    ).toHaveAttribute("href", "/domains/new");
  });

  it("active 未指定ならどの項目も光らせない", () => {
    renderSidebar();

    for (const name of [
      "ダッシュボード",
      "ドメイン取得",
      "移管",
      "設定",
      "ログ",
    ]) {
      expect(screen.getByRole("link", { name })).not.toHaveAttribute(
        "aria-current",
      );
    }
  });

  it("ユーザー名を出し、ログアウトで onLogout を呼ぶ", async () => {
    const user = userEvent.setup();
    const { onLogout } = renderSidebar("settings");

    expect(screen.getByText("たくたく")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ログアウト" }));

    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});

describe("activeNavKey", () => {
  it.each([
    ["/dashboard", "dashboard"],
    // 取得フローだけが「ドメイン取得」（最長一致が勝つ）
    ["/domains/new", "domains"],
    // 保有ドメインの画面はダッシュボードの続き（Figma S-30 / S-40）
    ["/domains/takutaku.com", "dashboard"],
    ["/domains/foo/subdomains", "dashboard"],
    ["/transfers", "transfers"],
    ["/settings/passkeys", "settings"],
    ["/logs", "logs"],
  ])("%s -> %s", (pathname, expected) => {
    expect(activeNavKey(pathname)).toBe(expected);
  });

  it.each(["/", "/login", "/domainsx", "/settingsy/z"])(
    "どのナビにも当たらない %s は undefined",
    (pathname) => {
      expect(activeNavKey(pathname)).toBeUndefined();
    },
  );
});
