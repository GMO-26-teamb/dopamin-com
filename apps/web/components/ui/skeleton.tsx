import { cn } from "@/lib/utils";

/**
 * Figma: Skeleton `75:14`
 * Shape（Line 12 / Block 36 / Card 120）。幅は置き場所に合わせるので既定は w-full。
 * シマーは `motion-reduce` で止まる（要件 §15.3）。
 */
const SHAPE = {
  line: "h-3 w-full",
  block: "h-control-md w-full",
  card: "h-30 w-full",
} as const;

export interface SkeletonProps {
  shape?: "line" | "block" | "card";
  className?: string;
}

export function Skeleton({ shape = "line", className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse bg-track motion-reduce:animate-none",
        SHAPE[shape],
        className,
      )}
    />
  );
}
