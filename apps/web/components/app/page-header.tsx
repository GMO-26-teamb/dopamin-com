import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Figma: Page Header `51:372`
 * メインエリアの先頭。Title + Meta（件数・最終同期など）+ 右端アクション。
 */
export interface PageHeaderProps {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  meta,
  action,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex w-full flex-wrap items-center gap-x-3 gap-y-2",
        className,
      )}
    >
      <h1 className="text-heading-section text-ink">{title}</h1>
      {meta === undefined ? null : (
        <p className="min-w-0 text-caption text-muted">{meta}</p>
      )}
      <div aria-hidden="true" className="min-w-0 flex-1" />
      {action === undefined ? null : <div className="shrink-0">{action}</div>}
    </div>
  );
}
