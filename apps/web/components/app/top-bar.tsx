import type { ReactNode } from "react";
import { Logo, Sticker } from "@/components/ui/brand";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";

/**
 * Figma: Top Bar `51:353`
 * ランディング / 404 / 500 のトップバー。Logo + Sticker + テーマ切替 + 右端アクション。
 *
 * テーマ切替はサイドバーにしか無く、未認証の画面では極ドパモードに触れられなかった（#225）。
 * 最初に来る画面なので、ここに置く。
 */
export interface TopBarProps {
  action?: ReactNode;
  className?: string;
}

export function TopBar({ action, className }: TopBarProps) {
  return (
    <header
      className={cn(
        "flex w-full flex-wrap items-center gap-x-3 gap-y-2 border-line border-b-2 border-solid bg-bg px-4 py-3 sm:px-8 sm:py-4",
        className,
      )}
    >
      <Logo />
      {/* Sticker は装飾なので、狭い幅ではテーマ切替に場所を譲る */}
      <Sticker className="hidden md:inline-flex" />
      {/* 狭い幅では spacer を畳んで、収まらないぶんを次の行に送る */}
      <div aria-hidden="true" className="hidden min-w-0 flex-1 sm:block" />
      <ThemeToggle size="sm" />
      {action}
    </header>
  );
}
