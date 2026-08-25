import { cn } from "@/lib/utils";

/**
 * Figma: Progress Bar `48:19`
 * 有効期限プログレス。Tone（Brand / Warn）× Size（Default 6px / Thin 4px）。
 */
const TONE = {
  brand: "bg-[image:var(--gradient-brand)]",
  warn: "bg-warn",
} as const;

const SIZE = {
  md: "h-1.5",
  thin: "h-1",
} as const;

/** 0〜100 に丸める（NaN は 0 扱い） */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

export interface ProgressBarProps {
  /** 0〜100 */
  value: number;
  tone?: "brand" | "warn";
  size?: "md" | "thin";
  /** 何の進捗かを読み上げるので必須 */
  "aria-label": string;
  className?: string;
}

export function ProgressBar({
  value,
  tone = "brand",
  size = "md",
  className,
  "aria-label": ariaLabel,
}: ProgressBarProps) {
  const percent = clampPercent(value);

  return (
    <div
      aria-label={ariaLabel}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={percent}
      className={cn("w-full overflow-hidden bg-track", SIZE[size], className)}
      role="progressbar"
    >
      <div
        className={cn("h-full", TONE[tone])}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
