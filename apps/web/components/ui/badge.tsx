import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Figma: Badge `44:48`
 * ステータスピル。Tone（Neutral / Ok / Warn / Muted / Brand）× Style（Outline / Solid）。
 * 枠は 1.5px（--stroke-medium）、文字は Label/Tiny。Brand の Outline だけ枠も文字もグラデーション。
 */
const TONE = {
  neutral: {
    outline: "border-ink text-ink",
    solid: "bg-ink text-bg",
  },
  ok: {
    outline: "border-ok text-ok",
    solid: "bg-ok text-bg",
  },
  warn: {
    outline: "border-warn text-warn",
    solid: "bg-warn text-on-brand",
  },
  muted: {
    outline: "border-muted text-muted",
    solid: "bg-muted text-bg",
  },
  brand: {
    outline:
      "border-transparent [border-image:var(--gradient-brand)_1] text-brand-1",
    solid: "brand-gradient text-on-brand",
  },
} as const;

/** Brand の Outline は文字もグラデーションで塗る（アイコンは brand-1 のまま） */
const BRAND_OUTLINE_LABEL = "brand-text";

export interface BadgeProps {
  tone?: "neutral" | "ok" | "warn" | "muted" | "brand";
  variant?: "outline" | "solid";
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Badge({
  tone = "neutral",
  variant = "outline",
  icon,
  children,
  className,
}: BadgeProps) {
  const isBrandOutline = tone === "brand" && variant === "outline";

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 px-2 py-0.5 text-label-xs",
        variant === "outline" && "border-[length:var(--stroke-medium)]",
        TONE[tone][variant],
        className,
      )}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className="inline-flex size-3 shrink-0 items-center justify-center [&_svg]:size-full"
        >
          {icon}
        </span>
      ) : null}
      <span className={cn(isBrandOutline && BRAND_OUTLINE_LABEL)}>
        {children}
      </span>
    </span>
  );
}
