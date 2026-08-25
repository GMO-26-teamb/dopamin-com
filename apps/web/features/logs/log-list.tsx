"use client";

import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { ApiClientError } from "@/lib/api/errors";
import { toErrorCopy } from "@/lib/error-messages";
import { LoadMore, usePagedLogs } from "./load-more";

/**
 * ログ一覧の状態分岐（S-60 / S-61 / S-62 / S-63）。
 *
 * 読み込みは Skeleton 行 ×6、取得失敗は Banner Warn + 再試行、0 件は Empty State
 * （docs/specs/ui-screens.md §2.7 / §4）。操作ログ・AI ログで行の中身だけが違うので、
 * 行の描画だけ呼び出し側から渡す。
 */

const SKELETON_ROWS = 6;

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

export interface LogListProps<T> {
  query: LogQuery<T>;
  /** 一覧のアクセシブルネーム（「操作ログ」/「AI ログ」） */
  listLabel: string;
  renderRow: (item: T) => ReactNode;
}

export function LogList<T>({ query, listLabel, renderRow }: LogListProps<T>) {
  const paged = usePagedLogs<T>(query.data ?? NO_ITEMS);

  if (query.isPending) {
    return (
      <div aria-hidden="true" className="flex w-full flex-col gap-4 py-2">
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 並び順が固定のプレースホルダ
          <Skeleton key={index} />
        ))}
      </div>
    );
  }

  if (query.error !== null) {
    const copy = toErrorCopy(query.error);
    return (
      <Banner
        action={
          <Button
            leadingIcon={<RefreshCw />}
            onClick={() => {
              query.refetch();
            }}
            size="sm"
            variant="outline"
          >
            再試行
          </Button>
        }
        body={copy.body}
        title={copy.title}
        tone="warn"
      />
    );
  }

  if (paged.total === 0) {
    return <EmptyState body={EMPTY_BODY} title={EMPTY_TITLE} />;
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <ul aria-label={listLabel} className="flex w-full flex-col">
        {paged.visible.map(renderRow)}
      </ul>
      {paged.remaining > 0 ? (
        <LoadMore onClick={paged.loadMore} remaining={paged.remaining} />
      ) : null}
    </div>
  );
}
