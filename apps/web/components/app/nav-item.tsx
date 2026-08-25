import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Figma: Nav Item `51:24`
 * サイドバーのナビ項目。State（Default / Active）。Active は panel 背景 + 左 3px のブランド線。
 *
 * 既定側にも同じ幅の透明な左線を敷いて、Active との文字位置のズレを防ぐ。
 */
export interface NavItemProps {
  href: string;
  active: boolean;
  icon?: ReactNode;
  children: ReactNode;
}

export function NavItem({ href, active, icon, children }: NavItemProps) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2 border-l-[length:var(--stroke-accent)] border-solid px-2 py-1.5 transition-colors",
        active
          ? "border-brand-1 bg-panel text-ink text-label"
          : "border-transparent text-body-sm text-muted hover:bg-hover",
      )}
      href={href}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className="inline-flex size-3.5 shrink-0 items-center justify-center [&_svg]:size-full"
        >
          {icon}
        </span>
      ) : null}
      {children}
    </Link>
  );
}
