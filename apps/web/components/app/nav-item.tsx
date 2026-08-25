"use client";

import { motion } from "motion/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useReducedMotion } from "@/lib/theme/use-reduced-motion";
import { cn } from "@/lib/utils";

/**
 * Figma: Nav Item `51:24`
 * サイドバーのナビ項目。State（Default / Active）。Active は panel 背景 + 左 3px のブランド線。
 *
 * ブランド線は `layoutId` を共有する 1 本の要素なので、Active が別の項目に移るときに
 * 上下へ滑って追いかける（動きを減らす設定では瞬時に移る）。
 */
export interface NavItemProps {
  href: string;
  active: boolean;
  icon?: ReactNode;
  children: ReactNode;
  /** 同じナビ内で共有するインジケータの id。省略時は "sidebar-nav" */
  indicatorId?: string;
  /** vertical = 左に線（サイドバー）/ horizontal = 下に線（モバイルの横ナビ） */
  orientation?: "vertical" | "horizontal";
}

export function NavItem({
  href,
  active,
  icon,
  children,
  indicatorId = "sidebar-nav",
  orientation = "vertical",
}: NavItemProps) {
  const reduced = useReducedMotion();

  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-2 whitespace-nowrap transition-colors",
        orientation === "vertical"
          ? "w-full py-2 pr-2 pl-3"
          : "shrink-0 px-3 pt-1 pb-2.5",
        active ? "bg-panel text-ink text-label" : "text-body-sm text-muted",
        !active && "hover:bg-hover hover:text-ink",
      )}
      href={href}
    >
      {active ? (
        <motion.span
          aria-hidden="true"
          className={cn(
            "brand-gradient absolute",
            orientation === "vertical"
              ? "inset-y-0 left-0 w-[length:var(--stroke-accent)]"
              : "inset-x-0 bottom-0 h-[length:var(--stroke-accent)]",
          )}
          layoutId={indicatorId}
          transition={
            reduced
              ? { duration: 0 }
              : { type: "spring", stiffness: 500, damping: 40 }
          }
        />
      ) : null}
      {icon ? (
        <span
          aria-hidden="true"
          className="inline-flex size-4 shrink-0 items-center justify-center [&_svg]:size-full"
        >
          {icon}
        </span>
      ) : null}
      <span className="transition-transform duration-200 ease-out group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0">
        {children}
      </span>
    </Link>
  );
}
