import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MobileNav } from "./mobile-nav";
import type { SidebarNavKey } from "./sidebar";

function renderMobileNav(active?: SidebarNavKey) {
  render(
    <TooltipProvider>
      <MobileNav active={active} onLogout={vi.fn()} />
    </TooltipProvider>,
  );
}

describe("MobileNav", () => {
  it("ナビは Sidebar と同じ 3 項目で、ログは出さない", () => {
    renderMobileNav("dashboard");

    const nav = screen.getByRole("navigation", {
      name: "メインナビゲーション",
    });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["ダッシュボード", "移管", "設定"]);
    expect(screen.queryByRole("link", { name: "ログ" })).toBeNull();
  });

  it("CTA のラベルは Sidebar と同じ「ドメインを取得」", () => {
    renderMobileNav("dashboard");

    const cta = screen.getByRole("link", { name: "ドメインを取得" });
    expect(cta).toHaveAttribute("href", "/domains/new");
    expect(cta).toHaveTextContent("ドメインを取得");
  });

  it("取得フローにいるあいだは CTA が現在地を示す", () => {
    renderMobileNav("domains");

    expect(
      screen.getByRole("link", { name: "ドメインを取得" }),
    ).toHaveAttribute("aria-current", "page");
  });
});
