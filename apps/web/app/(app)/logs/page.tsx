import { Suspense } from "react";
import { PageHeader } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { LogTabs } from "@/features/logs/log-tabs";

/**
 * S-60 `/logs`（操作ログ）/ S-61 `/logs?tab=ai`（AI ログ）/ S-62 0 件 / S-63 読み込み・取得失敗。
 * Figma: S-60 `85:6086`、S-61 `85:6309`、S-62 `85:6474`
 *
 * タブは `useSearchParams()` で URL と同期するため、Suspense 境界を置く
 * （`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md`）。
 */

const SKELETON_ROWS = 6;

function LogsFallback() {
  return (
    <>
      <PageHeader title="ログ" />
      <div aria-hidden="true" className="flex w-full flex-col gap-4 py-2">
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 並び順が固定のプレースホルダ
          <Skeleton key={index} />
        ))}
      </div>
    </>
  );
}

export default function LogsPage() {
  return (
    <Suspense fallback={<LogsFallback />}>
      <LogTabs />
    </Suspense>
  );
}
