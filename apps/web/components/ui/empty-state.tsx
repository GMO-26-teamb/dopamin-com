import { Globe, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Figma: Empty State `75:84`
 * 0 件 / 取得失敗の案内。Neutral は破線の soft 枠、Warn は実線の warn 枠。
 * ボタンは呼び出し側から `primary` / `secondary` に <Button> を渡す。
 */
const TONE = {
  neutral: { box: "border-soft border-dashed", text: "text-ink", Icon: Globe },
  warn: {
    box: "border-warn border-solid",
    text: "text-warn",
    Icon: TriangleAlert,
  },
} as const;

export interface EmptyStateProps {
  tone?: "neutral" | "warn";
  icon?: ReactNode;
  title: string;
  body?: string;
  primary?: ReactNode;
  secondary?: ReactNode;
  className?: string;
}

export function EmptyState({
  tone = "neutral",
  icon,
  title,
  body,
  primary,
  secondary,
  className,
}: EmptyStateProps) {
  const { box, text, Icon } = TONE[tone];

  return (
    <div
      className={cn(
        "flex w-full flex-col items-center justify-center gap-3 border-2 bg-panel px-8 py-10 text-center",
        box,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex size-7 shrink-0 items-center justify-center [&_svg]:size-full",
          text,
        )}
      >
        {icon ?? <Icon />}
      </span>
      <p className={cn("text-heading-card", text)}>{title}</p>
      {body === undefined ? null : (
        <p className="max-w-95 text-body-sm text-muted">{body}</p>
      )}
      {primary || secondary ? (
        <div className="flex items-center gap-2 pt-1">
          {primary}
          {secondary}
        </div>
      ) : null}
    </div>
  );
}
