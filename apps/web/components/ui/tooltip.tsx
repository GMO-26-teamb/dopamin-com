"use client";

import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Figma に対応コンポーネントはない（設計書 §5 の Tooltip は「—」）。
 * Solid ボタンと同じ ink 面 + bg 文字で、角丸なし・Caption 文字に揃えている。
 * アプリ全体を 1 つの `TooltipProvider` で包むこと。
 */
export function TooltipProvider({
  delayDuration = 200,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />;
}

export interface TooltipProps {
  content: ReactNode;
  /** asChild で渡すのでフォーカス可能な単一要素にすること */
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

export function Tooltip({
  content,
  children,
  side = "top",
  className,
}: TooltipProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          className={cn(
            "z-50 max-w-72 bg-ink px-2.5 py-1.5 text-bg text-caption leading-snug",
            "tooltip-enter",
            className,
          )}
          side={side}
          sideOffset={6}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
