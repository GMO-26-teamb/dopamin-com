"use client";

import { Check, Info, TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { IconButton } from "./icon-button";

/**
 * Figma: Banner `69:60`
 * 結果・案内の帯。Tone（Ok / Warn / Info）。メインエリア先頭に幅いっぱいで置く。
 * 読み上げは warn だけ role="alert"（割り込む）、ok / info は role="status"。
 */
const TONE = {
  ok: { border: "border-ok", text: "text-ok", Icon: Check },
  warn: { border: "border-warn", text: "text-warn", Icon: TriangleAlert },
  info: { border: "border-line", text: "text-ink", Icon: Info },
} as const;

export interface BannerProps {
  tone: "ok" | "warn" | "info";
  title: string;
  body?: string;
  onClose?: () => void;
  action?: ReactNode;
  className?: string;
  closeLabel?: string;
}

export function Banner({
  tone,
  title,
  body,
  onClose,
  action,
  className,
  closeLabel = "閉じる",
}: BannerProps) {
  const { border, text, Icon } = TONE[tone];

  return (
    <div
      className={cn(
        "flex w-full items-center gap-3 border-2 border-solid bg-panel px-4 py-3",
        border,
        className,
      )}
      role={tone === "warn" ? "alert" : "status"}
    >
      <Icon aria-hidden="true" className={cn("size-4.5 shrink-0", text)} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className={cn("text-label", text)}>{title}</p>
        {body === undefined ? null : (
          <p className="text-caption text-muted">{body}</p>
        )}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
      {onClose ? (
        <IconButton
          aria-label={closeLabel}
          icon={<X />}
          onClick={onClose}
          size="sm"
          variant="subtle"
        />
      ) : null}
    </div>
  );
}
