"use client";

import { LogOut, Plus } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/ui/brand";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { NavItem } from "./nav-item";
import { SIDEBAR_NAV, type SidebarNavKey } from "./sidebar";

/**
 * md 未満（サイドバーを出せない幅）のヘッダ。Logo + 主要 CTA + 横スクロールするナビ。
 * 項目の並びと Active 判定は Sidebar と同じ `SIDEBAR_NAV` / `activeNavKey` を使う。
 */
export interface MobileNavProps {
  active?: SidebarNavKey;
  onLogout: () => void;
  className?: string;
}

export function MobileNav({ active, onLogout, className }: MobileNavProps) {
  // Sidebar と同じ扱い。取得フローにいるあいだは CTA が現在地を示す
  // （横ナビなので線は Nav Item と同じく下端）。
  const atDomainsNew = active === "domains";

  return (
    <header
      className={cn(
        "sticky top-0 z-10 flex w-full flex-col gap-2 border-line border-b-2 border-solid bg-bg px-4 pt-3",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <Logo />
        <div className="flex items-center gap-1">
          <Tooltip content="ログアウト">
            <IconButton
              aria-label="ログアウト"
              icon={<LogOut />}
              onClick={onLogout}
              size="sm"
              variant="subtle"
            />
          </Tooltip>
          <Button
            asChild
            className="relative"
            leadingIcon={<Plus />}
            size="sm"
            variant={atDomainsNew ? "outline" : "primary"}
          >
            <Link
              aria-current={atDomainsNew ? "page" : undefined}
              href="/domains/new"
            >
              ドメインを取得
              {atDomainsNew ? (
                <span
                  aria-hidden="true"
                  className="brand-gradient absolute inset-x-0 bottom-0 h-[length:var(--stroke-accent)]"
                />
              ) : null}
            </Link>
          </Button>
        </div>
      </div>
      <nav
        aria-label="メインナビゲーション"
        className="-mx-4 flex overflow-x-auto px-4 [scrollbar-width:none]"
      >
        {SIDEBAR_NAV.map((item) => (
          <NavItem
            active={item.key === active}
            href={item.href}
            indicatorId="mobile-nav"
            key={item.key}
            orientation="horizontal"
          >
            {item.label}
          </NavItem>
        ))}
      </nav>
    </header>
  );
}
