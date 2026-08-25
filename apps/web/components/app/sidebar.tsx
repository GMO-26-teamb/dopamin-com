"use client";

import { Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/ui/brand";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { NavItem } from "./nav-item";
import { ThemeToggle } from "./theme-toggle";

/**
 * Figma: Sidebar `51:348`
 * 190px 固定。Logo → 主要 CTA → ナビ 5 項目 → 下部にテーマトグル + ユーザー行
 * （docs/specs/ui-screens.md §1）。
 */

export type SidebarNavKey =
  | "dashboard"
  | "domains"
  | "transfers"
  | "settings"
  | "logs";

interface NavDef {
  key: SidebarNavKey;
  href: string;
  label: string;
}

/** ナビの並びは Figma の nav-0〜nav-4 と同じ */
export const SIDEBAR_NAV: readonly NavDef[] = [
  { key: "dashboard", href: "/dashboard", label: "ダッシュボード" },
  { key: "domains", href: "/domains/new", label: "ドメイン取得" },
  { key: "transfers", href: "/transfers", label: "移管" },
  { key: "settings", href: "/settings", label: "設定" },
  { key: "logs", href: "/logs", label: "ログ" },
];

export interface SidebarProps {
  active: SidebarNavKey;
  userName: string;
  onLogout: () => void;
  /** AI ログパネルを開く。省略時はボタンを出さない */
  onOpenAiLogs?: () => void;
  className?: string;
}

export function Sidebar({
  active,
  userName,
  onLogout,
  onOpenAiLogs,
  className,
}: SidebarProps) {
  return (
    <div
      className={cn(
        "flex w-sidebar shrink-0 flex-col gap-1 border-line border-r-2 border-solid bg-bg px-3 py-4",
        className,
      )}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <Logo />
        {onOpenAiLogs ? (
          // ui-screens §1「AI ログパネルは全画面から開ける（sparkles アイコン）」
          <Tooltip content="AI ログ">
            <IconButton
              aria-label="AI ログを開く"
              icon={<Sparkles />}
              onClick={onOpenAiLogs}
              size="sm"
              variant="subtle"
            />
          </Tooltip>
        ) : null}
      </div>

      <Button
        asChild
        className="mt-2 w-full"
        leadingIcon={<Plus />}
        size="sm"
        variant="primary"
      >
        <Link href="/domains/new">ドメインを取得</Link>
      </Button>

      <nav
        aria-label="メインナビゲーション"
        className="mt-1.5 flex w-full flex-col gap-1"
      >
        {SIDEBAR_NAV.map((item) => (
          <NavItem active={item.key === active} href={item.href} key={item.key}>
            {item.label}
          </NavItem>
        ))}
      </nav>

      <div aria-hidden="true" className="min-h-0 flex-1" />

      <div className="flex w-full flex-col items-start gap-2 border-soft border-t border-solid pt-2">
        <ThemeToggle size="sm" />
        <div className="flex w-full items-center justify-between gap-2">
          <span className="min-w-0 truncate text-caption text-muted">
            {userName}
          </span>
          <Button onClick={onLogout} size="sm" variant="subtle">
            ログアウト
          </Button>
        </div>
      </div>
    </div>
  );
}
