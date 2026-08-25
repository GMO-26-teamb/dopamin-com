"use client";

import { type ComponentProps, useId } from "react";
import { cn } from "@/lib/utils";
import { FIELD_SURFACE, type FieldSurface } from "./field-surface";

/**
 * Figma: Input `46:110`
 * 高さ 36（--size-control-md）、枠 2px。フォーカスでブランドグラデーションの枠になる。
 * `surface` は「入力欄が置かれている面」（塗り分けは `field-surface.ts`）。
 */
export interface InputProps extends Omit<ComponentProps<"input">, "size"> {
  label?: string;
  helper?: string;
  /** 設定すると helper の位置にこの文言を warn 色で出し、aria-invalid を立てる */
  error?: string;
  surface?: FieldSurface;
  monospace?: boolean;
}

export function Input({
  label,
  helper,
  error,
  surface = "bg",
  monospace = false,
  className,
  id,
  ...props
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;
  const message = error ?? helper;

  return (
    <div className="flex w-full flex-col gap-1">
      {label ? (
        <label className="text-label-sm text-muted" htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      <input
        aria-describedby={message ? messageId : undefined}
        aria-invalid={error ? true : undefined}
        className={cn(
          "h-control-md w-full border-2 px-3 py-0.5 text-ink placeholder:text-muted focus:outline-none disabled:border-soft disabled:text-muted disabled:opacity-[var(--opacity-disabled)]",
          FIELD_SURFACE[surface],
          monospace ? "text-code-input" : "text-body",
          error
            ? "border-warn"
            : "border-line focus:border-transparent focus:[border-image:var(--gradient-brand)_1]",
          className,
        )}
        id={inputId}
        {...props}
      />
      {message ? (
        <p
          className={cn("text-caption", error ? "text-warn" : "text-muted")}
          id={messageId}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
