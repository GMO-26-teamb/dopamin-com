import type { ReactNode } from "react";
import { Logo, Sticker } from "@/components/ui/brand";
import { cn } from "@/lib/utils";

/**
 * Figma: Top Bar `51:353`
 * ランディング / 404 / 500 のトップバー。Logo + Sticker + 右端アクション。
 */
export interface TopBarProps {
  action?: ReactNode;
  className?: string;
}

export function TopBar({ action, className }: TopBarProps) {
  return (
    <header
      className={cn(
        "flex w-full items-center gap-3 border-line border-b-2 border-solid bg-bg px-8 py-4",
        className,
      )}
    >
      <Logo />
      <Sticker />
      <div aria-hidden="true" className="min-w-0 flex-1" />
      {action}
    </header>
  );
}
