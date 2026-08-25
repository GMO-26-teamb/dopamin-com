"use client";

import { cva } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Figma: Icon Button `45:301`
 * アイコンのみの正方形ボタン。Style（Solid / Outline / Subtle）× Size（Medium 36 / Small 28）。
 */
export const iconButtonVariants = cva(
  "inline-flex shrink-0 items-center justify-center transition-[color,background-color,opacity] disabled:pointer-events-none disabled:opacity-[var(--opacity-disabled)]",
  {
    variants: {
      variant: {
        solid: "bg-ink text-bg hover:opacity-90",
        outline: "border-2 border-ink border-solid text-ink hover:bg-hover",
        subtle:
          "border-[length:var(--stroke-medium)] border-soft border-solid text-muted hover:bg-hover",
      },
      size: {
        sm: "size-control-sm",
        md: "size-control-md",
      },
    },
    defaultVariants: {
      variant: "solid",
      size: "md",
    },
  },
);

const ICON_SIZE = {
  sm: "size-3.5",
  md: "size-4",
} as const;

export interface IconButtonProps extends ComponentProps<"button"> {
  variant?: "solid" | "outline" | "subtle";
  size?: "sm" | "md";
  /** アイコンだけのボタンなので必須 */
  "aria-label": string;
  icon: ReactNode;
}

export function IconButton({
  variant = "solid",
  size = "md",
  icon,
  className,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      className={cn(iconButtonVariants({ variant, size }), className)}
      type={type}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex shrink-0 items-center justify-center [&_svg]:size-full",
          ICON_SIZE[size],
        )}
      >
        {icon}
      </span>
    </button>
  );
}
