"use client";

import { Tabs as TabsPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Figma: Tabs `75:4453` / Tab Item `75:4452`
 * 行の下端は 1px soft、アクティブなタブだけ 2px ink の下線。件数は muted の 1.5px 枠。
 */
export function Tabs({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      className={cn("flex flex-col gap-4", className)}
      {...props}
    />
  );
}

export function TabsList({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("flex w-full items-start border-soft border-b", className)}
      {...props}
    />
  );
}

export interface TabsTriggerProps
  extends ComponentProps<typeof TabsPrimitive.Trigger> {
  count?: number;
  /** ラベルの前に置く記号（Button の leadingIcon と同じ 16px 枠） */
  icon?: ReactNode;
}

export function TabsTrigger({
  count,
  icon,
  className,
  children,
  ...props
}: TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "-mb-px inline-flex items-center gap-1.5 border-transparent border-b-2 px-3 py-2 text-label text-muted transition-colors hover:text-ink data-[state=active]:border-ink data-[state=active]:text-ink",
        className,
      )}
      {...props}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className="inline-flex size-4 shrink-0 items-center justify-center [&_svg]:size-full"
        >
          {icon}
        </span>
      ) : null}
      {children}
      {count === undefined ? null : (
        <span className="inline-flex items-center border-[length:var(--stroke-medium)] border-muted px-2 py-0.5 text-label-xs text-muted">
          {count}
        </span>
      )}
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("focus:outline-none", className)}
      {...props}
    />
  );
}
