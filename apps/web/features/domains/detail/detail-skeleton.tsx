import { Skeleton } from "@/components/ui/skeleton";

/**
 * Figma: S-35 `83:3348`（読み込み）
 * 形は S-30 の実コンテンツに合わせる（ui-screens §4）。
 */
export function DetailSkeleton() {
  return (
    <div className="flex w-full flex-col gap-3.5" data-testid="detail-skeleton">
      <div className="flex w-full items-center gap-2.5">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-5 w-20" />
        <div aria-hidden="true" className="min-w-0 flex-1" />
        <Skeleton className="h-control-sm w-24" />
      </div>
      <div className="flex w-full items-start gap-3.5">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Skeleton shape="card" />
          <Skeleton className="h-24" shape="card" />
          <div className="flex w-full items-start gap-3">
            <Skeleton className="h-20" shape="card" />
            <Skeleton className="h-20" shape="card" />
          </div>
        </div>
        <Skeleton className="h-72 w-80 shrink-0" shape="card" />
      </div>
      <span className="sr-only">読み込み中…</span>
    </div>
  );
}
