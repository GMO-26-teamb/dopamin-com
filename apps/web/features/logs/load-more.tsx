"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * ログ一覧の「もっと見る」（S-60 / S-61）。
 *
 * 要件 §10.1 の `GET /logs/operations` / `GET /logs/ai` はページング前提だが、
 * いまの `LogService`（fe-ui 設計 §4.2）は `Promise<OperationLog[]>` を返す 1 ページ実装で、
 * hooks（`useOperationLogs` / `useAiLogs`）にも cursor / `fetchNextPage` は無い。
 * そこで取得済みの配列をクライアント側で刻んで出す。API に cursor が入ったら
 * この `LOG_PAGE_SIZE` をそのまま `limit` に渡して `useInfiniteQuery` へ寄せる。
 */

/** モックの fixtures が操作ログ 5 件 / AI ログ 4 件なので、デモで「もっと見る」が出る刻み幅にする。 */
export const LOG_PAGE_SIZE = 3;

export interface PagedLogs<T> {
  visible: T[];
  remaining: number;
  total: number;
  loadMore: () => void;
}

export function usePagedLogs<T>(
  items: readonly T[],
  pageSize: number = LOG_PAGE_SIZE,
): PagedLogs<T> {
  const [pages, setPages] = useState(1);
  const visible = items.slice(0, pages * pageSize);

  return {
    visible,
    remaining: items.length - visible.length,
    total: items.length,
    loadMore: () => setPages((current) => current + 1),
  };
}

export interface LoadMoreProps {
  remaining: number;
  onClick: () => void;
}

export function LoadMore({ remaining, onClick }: LoadMoreProps) {
  return (
    <Button
      className="self-start"
      leadingIcon={<ChevronDown />}
      onClick={onClick}
      size="sm"
      variant="outline"
    >
      もっと見る（残り {remaining} 件）
    </Button>
  );
}
