"use client";

import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { ApiClientError } from "@/lib/api/errors";
import { toErrorCopy } from "@/lib/error-messages";
import { LoadMore, usePagedLogs } from "./load-more";
import { LogRowsSkeleton } from "./log-skeleton";

/**
 * ログ一覧の状態分岐（S-60 / S-61 / S-62 / S-63）。
 *
 * 読み込みは Skeleton 行 ×6、取得失敗は Banner Warn + 再試行、0 件は Empty State
 * （docs/specs/ui-screens.md §2.7 / §4）。操作ログ・AI ログで行の中身だけが違うので、
 * 行の描画だけ呼び出し側から渡す。
 */

/** 参照のたびに新しい配列を作らないための空配列。 */
const NO_ITEMS: readonly never[] = [];

/** Figma: S-62 `85:6474` */
const EMPTY_TITLE = "ログはまだありません";
const EMPTY_BODY =
  "レジストリへの操作（登録・更新・移管など）と AI 呼び出しが、成功・失敗を問わずここに記録されます。";

/**
 * `useQuery` の戻りのうち、この一覧が使う部分だけ。
 * 操作ログ / AI ログで型引数が違うので、hooks の戻り値をそのまま受けられるようにしている。
 */
export interface LogQuery<T> {
  data: T[] | undefined;
  isPending: boolean;
  error: ApiClientError | null;
  refetch: () => unknown;
}

/**
 * S-63 の取得失敗（Banner Warn）。
 * 再試行は `error.retryable` のときだけ出す（`components/ui/error-card.tsx` と同じ規則）。
 * `NOT_IMPLEMENTED` や `UNAUTHORIZED` に再試行を出しても失敗し続けるだけなので出さない。
 */
function LogListErrorBanner({
  error,
  onRetry,
}: {
  error: ApiClientError;
  onRetry: () => void;
}) {
  const copy = toErrorCopy(error);

  return (
    <Banner
      {...(error.retryable
        ? {
            action: (
              <Button
                leadingIcon={<RefreshCw />}
                onClick={onRetry}
                size="sm"
                variant="outline"
              >
                再試行
              </Button>
            ),
          }
        : {})}
      body={copy.body}
      title={copy.title}
      tone="warn"
    />
  );
}

export interface LogListProps<T> {
  query: LogQuery<T>;
  /** 一覧のアクセシブルネーム（「操作ログ」/「AI ログ」） */
  listLabel: string;
  renderRow: (item: T) => ReactNode;
}

export function LogList<T>({ query, listLabel, renderRow }: LogListProps<T>) {
  const paged = usePagedLogs<T>(query.data ?? NO_ITEMS);

  if (query.isPending) {
    return <LogRowsSkeleton />;
  }

  /**
   * 参照系エラーは「画面内・キャッシュ表示を継続」（ui-screens §4）。
   * 再取得に失敗しても直前まで出ていた行は残し、Banner を上に足すだけにする。
   */
  const banner =
    query.error === null ? null : (
      <LogListErrorBanner
        error={query.error}
        onRetry={() => {
          query.refetch();
        }}
      />
    );

  if (paged.total === 0) {
    // 出せる行が無いときだけ Banner（または Empty State）で画面を占める
    return banner ?? <EmptyState body={EMPTY_BODY} title={EMPTY_TITLE} />;
  }

  return (
    <div className="flex w-full flex-col gap-3">
      {banner}
      <ul aria-label={listLabel} className="flex w-full flex-col">
        {paged.visible.map(renderRow)}
      </ul>
      {paged.remaining > 0 ? (
        <LoadMore onClick={paged.loadMore} remaining={paged.remaining} />
      ) : null}
    </div>
  );
}
