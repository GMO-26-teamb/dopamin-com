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
  it("ナビはダッシュボード / 移管 / 設定の 3 項目だけ並べる", () => {
    renderSidebar("dashboard");

    const nav = screen.getByRole("navigation", {
      name: "メインナビゲーション",
    });
    const links = within(nav).getAllByRole("link");

    expect(links.map((link) => link.textContent)).toEqual([
      "ダッシュボード",
      "移管",
      "設定",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/dashboard",
      "/transfers",
      "/settings",
    ]);
  });

  it("ログはナビに出さない（設定の「開発者向け」から開く）", () => {
    renderSidebar("dashboard");

    expect(screen.queryByRole("link", { name: "ログ" })).toBeNull();
  });

  it("ドメイン取得のナビ項目は置かず、CTA を唯一の入口にする", () => {
    renderSidebar("dashboard");

    const toNew = screen.getAllByRole("link", {
      name: "ドメインを取得",
    });
    expect(toNew).toHaveLength(1);
    expect(toNew[0]).toHaveAttribute("href", "/domains/new");
    expect(screen.queryByRole("link", { name: "ドメイン取得" })).toBeNull();
  });

  it("active のナビ項目にだけ aria-current=page が付く", () => {
    renderSidebar("transfers");

    expect(screen.getByRole("link", { name: "移管" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const name of ["ダッシュボード", "設定", "ドメインを取得"]) {
      expect(screen.getByRole("link", { name })).not.toHaveAttribute(
        "aria-current",
      );
    }
  });

  it("取得フローにいるあいだは CTA が現在地を示す", () => {
    renderSidebar("domains");

    expect(
      screen.getByRole("link", { name: "ドメインを取得" }),
    ).toHaveAttribute("aria-current", "page");
    for (const name of ["ダッシュボード", "移管", "設定"]) {
      expect(screen.getByRole("link", { name })).not.toHaveAttribute(
        "aria-current",
      );
    }
  });

  it("active 未指定ならどの項目も光らせない", () => {
    renderSidebar();

    for (const name of ["ダッシュボード", "移管", "設定", "ドメインを取得"]) {
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
    // 取得フローは CTA が Active（最長一致が勝つ）
    ["/domains/new", "domains"],
    // 保有ドメインの画面はダッシュボードの続き（Figma S-30 / S-40）
    ["/domains/takutaku.com", "dashboard"],
    ["/domains/foo/subdomains", "dashboard"],
    ["/transfers", "transfers"],
    ["/settings/passkeys", "settings"],
    // ナビには出さないが現在地としては持つ
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
