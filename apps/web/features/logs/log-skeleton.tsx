import { Skeleton } from "@/components/ui/skeleton";

/**
 * S-63 の読み込み表示（Skeleton 行 ×6、docs/specs/ui-screens.md §2.7）。
 *
 * `app/(app)/logs/page.tsx`（Suspense の fallback、Server Component）と
 * `features/logs/log-list.tsx`（取得中）の両方から使うので、
 * `"use client"` を付けずに純表示のまま置いている。
 */
const SKELETON_ROWS = 6;

export function LogRowsSkeleton() {
  return (
    <div aria-hidden="true" className="flex w-full flex-col gap-4 py-2">
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 並び順が固定のプレースホルダ
        <Skeleton key={index} />
      ))}
    </div>
  );
}
