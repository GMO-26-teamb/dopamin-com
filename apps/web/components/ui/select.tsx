"use client";

import { Check, ChevronDown } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Figma: Input `46:110`（Type = Select）
 * トリガーはテキスト入力と同じ枠・高さ。開いている間はブランドグラデーションの枠にする。
 */
const SURFACE = {
  bg: "bg-panel",
  panel: "bg-bg",
} as const;

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  label?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  surface?: "bg" | "panel";
  helper?: string;
  disabled?: boolean;
  className?: string;
}

export function Select({
  label,
  value,
  onValueChange,
  options,
  surface = "bg",
  helper,
  disabled = false,
  className,
}: SelectProps) {
  const triggerId = useId();
  const helperId = `${triggerId}-helper`;

  return (
    <div className="flex w-full flex-col gap-1">
      {label ? (
        <label className="text-label-sm text-muted" htmlFor={triggerId}>
          {label}
        </label>
      ) : null}
      <SelectPrimitive.Root
        disabled={disabled}
        onValueChange={onValueChange}
        value={value}
      >
        <SelectPrimitive.Trigger
          aria-describedby={helper ? helperId : undefined}
          className={cn(
            "flex h-control-md w-full items-center justify-between gap-2 border-2 border-line px-3 text-body text-ink transition-colors focus:border-transparent focus:outline-none focus:[border-image:var(--gradient-brand)_1] data-[placeholder]:text-muted data-[state=open]:border-transparent data-[state=open]:[border-image:var(--gradient-brand)_1] disabled:border-soft disabled:text-muted disabled:opacity-[var(--opacity-disabled)]",
            SURFACE[surface],
            className,
          )}
          id={triggerId}
        >
          <SelectPrimitive.Value />
          <SelectPrimitive.Icon asChild>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            className="z-50 min-w-[var(--radix-select-trigger-width)] border-2 border-line bg-panel"
            position="popper"
            sideOffset={4}
          >
            <SelectPrimitive.Viewport>
              {options.map((option) => (
                <SelectPrimitive.Item
                  className="flex cursor-default select-none items-center gap-2 px-3 py-1.5 text-body text-ink outline-none data-[disabled]:opacity-[var(--opacity-disabled)] data-[highlighted]:bg-hover"
                  key={option.value}
                  value={option.value}
                >
                  <SelectPrimitive.ItemText>
                    {option.label}
                  </SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className="ml-auto inline-flex">
                    <Check aria-hidden="true" className="size-3.5 shrink-0" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      {helper ? (
        <p className="text-caption text-muted" id={helperId}>
          {helper}
        </p>
      ) : null}
    </div>
  );
}
