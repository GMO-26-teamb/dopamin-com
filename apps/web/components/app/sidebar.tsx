"use client";

import {
  ArrowLeftRight,
  LayoutDashboard,
  LogOut,
  type LucideIcon,
  Plus,
  ScrollText,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/ui/brand";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NavItem } from "./nav-item";
import { ThemeToggle } from "./theme-toggle";

/**
 * Figma: Sidebar `51:348`
 * `--size-sidebar` 固定。Logo → 主要 CTA → ナビ → 下部にテーマトグル + ユーザー行
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
  /** ナビ項目の記号。既存の語彙を再利用する（S-80 のダッシュボード / 操作パネルの移管など） */
  Icon: LucideIcon;
  /** Active 判定に使う pathname の前方一致（複数可）。最長一致が勝つ */
  match: readonly string[];
}

/**
 * ナビに出す項目。
 *
 * 保有ドメインの画面（`/domains/<name>` / `.../subdomains`）はダッシュボードの
 * 続きなので「ダッシュボード」を光らせる（Figma S-30 / S-40）。
 */
export const SIDEBAR_NAV: readonly NavDef[] = [
  {
    key: "dashboard",
    href: "/dashboard",
    label: "ダッシュボード",
    Icon: LayoutDashboard,
    match: ["/dashboard", "/domains"],
  },
  {
    key: "transfers",
    href: "/transfers",
    label: "移管",
    Icon: ArrowLeftRight,
    match: ["/transfers"],
  },
  {
    key: "settings",
    href: "/settings",
    label: "設定",
    Icon: Settings,
    match: ["/settings"],
  },
];

/**
 * ナビには並べないが現在地は持つ画面。
 *
 * - `domains`: 取得フローの入口は上の主要 CTA 1 つに寄せた。CTA 側を Active にする
 *   （ここに `/domains/new` を残さないと「ダッシュボード」が光ってしまう）
 * - `logs`: 設定の「開発者向け」からだけ開く
 */
const HIDDEN_NAV: readonly NavDef[] = [
  {
    key: "domains",
    href: "/domains/new",
    label: "ドメインを取得",
    Icon: Plus,
    match: ["/domains/new"],
  },
  {
    key: "logs",
    href: "/logs",
    label: "ログ",
    Icon: ScrollText,
    match: ["/logs"],
  },
];

/**
 * pathname からナビの Active を決める。より長い（＝具体的な）前方一致が勝つので、
 * `/domains/new` は「ドメインを取得」、`/domains/<name>` は「ダッシュボード」になる。
 * どれにも当たらないパス（`/` など）は `undefined` を返し、どの項目も光らせない。
 */
export function activeNavKey(pathname: string): SidebarNavKey | undefined {
  let best: { key: SidebarNavKey; length: number } | undefined;
  for (const { key, match } of [...SIDEBAR_NAV, ...HIDDEN_NAV]) {
    for (const prefix of match) {
      if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) {
        continue;
      }
      if (best === undefined || prefix.length > best.length) {
        best = { key, length: prefix.length };
      }
    }
  }
  return best?.key;
}

export interface SidebarProps {
  /** 省略・undefined ならどの項目も Active にしない */
  active?: SidebarNavKey;
  userName: string;
  onLogout: () => void;
  className?: string;
}

export function Sidebar({
  active,
  userName,
  onLogout,
  className,
}: SidebarProps) {
  // 取得フローにいるあいだは CTA が現在地を示す。Nav Item の Active と同じく
  // 左端のブランド線 + panel 地（= Outline）にして、光る列を 1 本に揃える。
  const atDomainsNew = active === "domains";

  return (
    <div
      className={cn(
        "flex w-sidebar shrink-0 flex-col gap-1 border-line border-r-2 border-solid bg-bg px-4 py-5",
        className,
      )}
    >
      <Logo />

      <Button
        asChild
        className="relative mt-2 w-full"
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
              className="brand-gradient absolute inset-y-0 left-0 w-[length:var(--stroke-accent)]"
            />
          ) : null}
        </Link>
      </Button>

      <nav
        aria-label="メインナビゲーション"
        className="mt-1.5 flex w-full flex-col gap-1"
      >
        {SIDEBAR_NAV.map((item) => (
          <NavItem
            active={item.key === active}
            href={item.href}
            icon={<item.Icon />}
            key={item.key}
          >
            {item.label}
          </NavItem>
        ))}
      </nav>

      <div aria-hidden="true" className="min-h-0 flex-1" />

      <div className="flex w-full flex-col items-start gap-2 border-soft border-t border-solid pt-2">
        <ThemeToggle size="sm" />
        {/*
          224px の列にユーザー名とボタンを横並びにすると名前が削れる
          （「デモユーザー」が「デモユー…」になっていた）。名前を上に置き、
          ボタンは全幅で下に敷く
        */}
        <span className="w-full truncate text-caption text-muted">
          {userName}
        </span>
        <Button
          className="w-full"
          leadingIcon={<LogOut />}
          onClick={onLogout}
          size="sm"
          variant="subtle"
        >
          ログアウト
        </Button>
      </div>
    </div>
  );
}
