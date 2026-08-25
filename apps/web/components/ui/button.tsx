"use client";

import { cva } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { Slot } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Figma: Button `45:251`
 * Style（Primary / Solid / Outline / Subtle / Danger）× Size（Small 28 / Medium 36 / Large 44）。
 * ラベルは左寄せ。Primary は 1 画面 1 つ。
 */
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-start py-0.5 transition-[color,background-color,opacity,transform,box-shadow] duration-150 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-[var(--opacity-disabled)] motion-reduce:transition-none motion-reduce:active:scale-100",
  {
    variants: {
      variant: {
        primary:
          "brand-gradient text-on-brand shadow-[var(--glow-brand)] hover:brightness-110 hover:shadow-[var(--glow-brand-hover)]",
        solid: "bg-ink text-bg hover:opacity-90",
        outline: "border-2 border-ink border-solid text-ink hover:bg-hover",
        subtle:
          "border-[length:var(--stroke-medium)] border-soft border-solid text-muted hover:bg-hover",
        danger: "border-2 border-solid border-warn text-warn hover:bg-hover",
      },
      size: {
        sm: "h-control-sm gap-1.5 px-3 text-label-sm",
        md: "h-control-md gap-2 px-4 text-label",
        lg: "h-control-lg gap-2 px-5 text-label",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

/** アイコン枠は Figma の Small 14 / Medium 16 / Large 20 に合わせる */
const ICON_SIZE = {
  sm: "size-3.5",
  md: "size-4",
  lg: "size-5",
} as const;

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: "primary" | "solid" | "outline" | "subtle" | "danger";
  size?: "sm" | "md" | "lg";
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  loading?: boolean;
  /** true のとき子要素（Link など）にスタイルを移譲する */
  asChild?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  leadingIcon,
  trailingIcon,
  loading = false,
  asChild = false,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  const iconClass = cn(
    "inline-flex shrink-0 items-center justify-center [&_svg]:size-full",
    ICON_SIZE[size],
  );
  const leading = loading ? (
    <LoaderCircle className="animate-spin motion-reduce:animate-none" />
  ) : (
    leadingIcon
  );

  const leadingNode = leading ? (
    <span aria-hidden="true" className={iconClass}>
      {leading}
    </span>
  ) : null;
  const trailingNode = trailingIcon ? (
    <span aria-hidden="true" className={iconClass}>
      {trailingIcon}
    </span>
  ) : null;

  const classes = cn(buttonVariants({ variant, size }), className);

  // asChild では type / disabled を子要素（a など）に流さない。
  // Slot は React.Children.forEach で直下の子しか見ないので、Fragment で包むと
  // Slottable が見つからず props が捨てられる。必ず直下に並べること。
  if (asChild) {
    return (
      <Slot.Root
        aria-busy={loading || undefined}
        className={classes}
        {...props}
      >
        {leadingNode}
        <Slot.Slottable>{children}</Slot.Slottable>
        {trailingNode}
      </Slot.Root>
    );
  }

  return (
    <button
      aria-busy={loading || undefined}
      className={classes}
      disabled={disabled || loading}
      type={type}
      {...props}
    >
      {leadingNode}
      {children}
      {trailingNode}
    </button>
  );
}
