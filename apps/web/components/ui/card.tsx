import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { HelpTip } from "./help-tip";

/**
 * Figma: Card `50:31` / Key Value Row `50:36` / Divider `50:41`
 * カード / 情報パネル。Emphasis で枠の色が変わる（Muted は枠 soft + 全体を薄く）。
 */
const EMPHASIS = {
  default: "border-line",
  brand: "border-brand-1",
  warn: "border-warn",
  // 不透明度で落とすと本文が 4.5:1 を割るので、枠だけで控えめさを出す（#95）
  muted: "border-soft",
} as const;

export interface CardProps {
  emphasis?: "default" | "brand" | "warn" | "muted";
  kicker?: string;
  title?: string;
  className?: string;
  children: ReactNode;
}

export function Card({
  emphasis = "default",
  kicker,
  title,
  className,
  children,
}: CardProps) {
  return (
    <div
      className={cn(
        "flex w-full flex-col items-start gap-2 border-2 border-solid bg-panel px-4 py-3",
        EMPHASIS[emphasis],
        className,
      )}
    >
      {kicker === undefined ? null : <CardKicker>{kicker}</CardKicker>}
      {title === undefined ? null : <CardTitle>{title}</CardTitle>}
      <div className="flex w-full flex-col gap-2">{children}</div>
    </div>
  );
}

/** カード上端の小見出し（Overline） */
export function CardKicker({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-overline text-muted", className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn("w-full text-heading-card text-ink", className)}
      {...props}
    />
  );
}

export interface KeyValueRowProps {
  label: string;
  value: ReactNode;
  /** ドメイン名・AuthCode などを等幅で見せる */
  mono?: boolean;
  /** ラベル横の「？」で出す補足（専門用語の説明など） */
  help?: string;
  className?: string;
}

export function KeyValueRow({
  label,
  value,
  mono = false,
  help,
  className,
}: KeyValueRowProps) {
  return (
    <div
      className={cn(
        "flex w-full items-center justify-between gap-2 text-body-sm",
        className,
      )}
    >
      <span className="inline-flex shrink-0 items-center gap-1 text-muted">
        {label}
        {help === undefined ? null : (
          <HelpTip content={help} label={`${label}とは`} />
        )}
      </span>
      <span
        className={cn("min-w-0 text-right text-ink", mono && "text-code-input")}
      >
        {value}
      </span>
    </div>
  );
}

export interface DividerProps {
  /** strong = 2px ink（セクション）/ thin = 1px soft（行の区切り） */
  weight?: "strong" | "thin";
  className?: string;
}

export function Divider({ weight = "strong", className }: DividerProps) {
  return (
    // preflight の hr は height:0 / border-top-width:1px なので両方打ち消す
    <hr
      className={cn(
        "w-full border-t-0",
        weight === "strong" ? "h-0.5 bg-line" : "h-px bg-soft",
        className,
      )}
    />
  );
}
