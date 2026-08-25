"use client";

import { Fragment, type ReactNode, useRef } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedControlOption<T extends string> {
  value: T;
  /** Goku などの装飾を含められるように ReactNode */
  label: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  /** Figma の Segmented Control は 2 択固定（Selected: Left / Right） */
  options: readonly [SegmentedControlOption<T>, SegmentedControlOption<T>];
  value: T;
  onChange: (value: T) => void;
  size?: "md" | "sm";
  "aria-label": string;
  className?: string;
}

const SEGMENT_SIZE = {
  md: "px-4 py-1.5 text-label-sm",
  sm: "px-2 py-1 text-label-xs",
} as const;

/**
 * 2 択のトグル（Figma: Segmented Control 47:41）。
 * ラジオではなくトグルボタン群として実装し、`aria-pressed` で選択状態を伝える。
 * ← → で選択とフォーカスを移す。
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  "aria-label": ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (index: number, delta: number) => {
    const nextIndex = (index + delta + options.length) % options.length;
    const next = options[nextIndex];
    if (!next) return;
    onChange(next.value);
    buttonRefs.current[nextIndex]?.focus();
  };

  return (
    // fieldset の暗黙ロールが group。legend は置かず aria-label で名前を付ける
    <fieldset
      aria-label={ariaLabel}
      className={cn(
        "inline-flex min-w-0 items-stretch border-ink border-solid",
        size === "md" ? "border-2" : "border-[length:var(--stroke-medium)]",
        className,
      )}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <Fragment key={option.value}>
            {index > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  "self-stretch bg-ink",
                  size === "md" ? "w-0.5" : "w-[var(--stroke-medium)]",
                )}
              />
            )}
            <button
              aria-pressed={selected}
              className={cn(
                "inline-flex items-center justify-center gap-0.5 transition-colors",
                SEGMENT_SIZE[size],
                selected ? "bg-ink text-bg" : "text-ink hover:bg-hover",
              )}
              onClick={() => onChange(option.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  move(index, 1);
                } else if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  move(index, -1);
                }
              }}
              ref={(node) => {
                buttonRefs.current[index] = node;
              }}
              type="button"
            >
              {option.label}
            </button>
          </Fragment>
        );
      })}
    </fieldset>
  );
}
