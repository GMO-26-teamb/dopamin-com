import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Figma: S-12 `80:5653`
 * Domain Card と同じ形の読み込み表示。DB キャッシュが無い初回だけ出す（ui-screens §4）。
 */

/** S-12: カード 4 枚。 */
export const DASHBOARD_SKELETON_COUNT = 4;

export function DomainCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex w-full flex-col gap-2 border-2 border-soft border-solid bg-panel px-4 py-3",
        className,
      )}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-16" />
      </div>
      <Skeleton className="h-1.5 w-full" />
      <div className="flex w-full items-center justify-between gap-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="flex items-center gap-1.5">
        <Skeleton className="h-control-sm w-20" />
        <Skeleton className="h-control-sm w-20" />
      </div>
    </div>
  );
}

export interface DomainGridSkeletonProps {
  count?: number;
  className?: string;
}

export function DomainGridSkeleton({
  count = DASHBOARD_SKELETON_COUNT,
  className,
}: DomainGridSkeletonProps) {
  return (
    <div
      aria-busy="true"
      className={cn("grid w-full grid-cols-2 gap-x-4 gap-y-3", className)}
      role="status"
    >
      <span className="sr-only">保有ドメインを読み込み中…</span>
      {Array.from({ length: count }, (_, index) => (
        // 並び順以外に区別する情報を持たない固定枚数のプレースホルダ
        // biome-ignore lint/suspicious/noArrayIndexKey: 静的なプレースホルダで並び替えが起きない
        <DomainCardSkeleton key={index} />
      ))}
    </div>
  );
}
