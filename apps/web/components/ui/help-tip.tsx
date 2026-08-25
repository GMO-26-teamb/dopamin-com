"use client";

import { CircleHelp } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipProvider } from "./tooltip";

/**
 * 「？」アイコンにマウスを乗せる / フォーカスすると説明が出る補助ボタン。
 * 専門用語（EPP ステータス・AuthCode・独自性スコアなど）や、初めての人が迷いそうな
 * 操作の横に置く。本文をすっきり保ちつつ、知りたい人だけが読めるようにするための部品。
 *
 * スクリーンリーダー向けには `aria-label` に本文をそのまま入れる（Tooltip は表示のみ）。
 * どこに置いても動くように自前の `TooltipProvider` で包む（Radix は入れ子を許す）。
 */
export interface HelpTipProps {
  /** 説明文。1〜2 文で、何が起きるか / なぜそうなるかを書く */
  content: ReactNode;
  /** 読み上げ用の短い名前。省略時は content が文字列ならそれを使う */
  label?: string;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

export function HelpTip({ content, label, side, className }: HelpTipProps) {
  const ariaLabel =
    label ?? (typeof content === "string" ? content : "補足を表示");

  return (
    <TooltipProvider>
      <Tooltip content={content} {...(side ? { side } : {})}>
        <button
          aria-label={ariaLabel}
          className={cn(
            "inline-flex size-4 shrink-0 cursor-help items-center justify-center text-muted transition-colors hover:text-ink focus-visible:text-ink [&_svg]:size-full",
            className,
          )}
          type="button"
        >
          <CircleHelp aria-hidden="true" />
        </button>
      </Tooltip>
    </TooltipProvider>
  );
}
