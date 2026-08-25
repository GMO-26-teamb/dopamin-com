"use client";

import { ERROR_STATUS } from "@dopamin/shared";
import { ArrowRight, RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ApiClientError, ClientErrorCode } from "@/lib/api/errors";
import { toErrorCopy } from "@/lib/error-messages";
import { cn } from "@/lib/utils";
import { Badge } from "./badge";
import { Button } from "./button";

/**
 * Figma: Error Card `75:87`
 * レジストリ通信エラーの表示（FR-18）。文言は `toErrorCopy` に一本化し、
 * ここではコード / HTTP ステータス / リクエスト ID の提示と再試行導線だけを持つ。
 */

/** `NOT_IMPLEMENTED` / `NETWORK` は HTTP を持たない（undefined になる） */
const HTTP_STATUS: Partial<Record<ClientErrorCode, number>> = ERROR_STATUS;

/** 操作ログ画面（要件 §10.1 の /logs） */
const LOGS_HREF = "/logs";

export interface ErrorCardProps {
  error: ApiClientError;
  onRetry?: () => void;
  showLogsLink?: boolean;
  /** 操作ログへのリンク先（既定 /logs） */
  logsHref?: string;
  className?: string;
}

export function ErrorCard({
  error,
  onRetry,
  showLogsLink = false,
  logsHref = LOGS_HREF,
  className,
}: ErrorCardProps) {
  const copy = toErrorCopy(error);
  const status = HTTP_STATUS[error.code];
  const canRetry = onRetry !== undefined && error.retryable;

  return (
    <div
      className={cn(
        "flex w-full flex-col items-start gap-2 border-2 border-warn border-solid bg-panel px-4 py-3",
        className,
      )}
      role="alert"
    >
      <div className="flex w-full items-center gap-2">
        <TriangleAlert
          aria-hidden="true"
          className="size-4.5 shrink-0 text-warn"
        />
        <p className="min-w-0 flex-1 text-label text-warn">{copy.title}</p>
      </div>
      <p className="w-full text-caption text-muted">{copy.body}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="warn">{error.code}</Badge>
        {status === undefined ? null : <Badge tone="muted">{status}</Badge>}
        {error.requestId === undefined ? null : (
          <span className="text-code text-muted">{error.requestId}</span>
        )}
      </div>
      {canRetry || showLogsLink ? (
        <div className="flex items-center gap-1.5 pt-1">
          {canRetry ? (
            <Button
              leadingIcon={<RefreshCw />}
              onClick={onRetry}
              size="sm"
              variant="outline"
            >
              再試行
            </Button>
          ) : null}
          {showLogsLink ? (
            <Button
              asChild
              size="sm"
              trailingIcon={<ArrowRight />}
              variant="subtle"
            >
              <Link href={logsHref}>操作ログを見る</Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
