"use client";

import { RefreshCw } from "lucide-react";
import { TopBar } from "@/components/app/top-bar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorCard } from "@/components/ui/error-card";
import { ApiClientError, toApiClientError } from "@/lib/api/errors";

/**
 * S-81（500、Figma `80:315`）。
 * Empty State Warn +（コード / HTTP / request ID を出す）Error Card。
 * 再試行はここの「再読み込み」1 つに集約するので、Error Card 側には onRetry を渡さない。
 */

type BoundaryError = Error & { digest?: string };

/** サーバー由来のエラーは message が伏せられ、代わりに digest が付く（= request ID 相当） */
function normalize(error: BoundaryError): ApiClientError {
  const normalized = toApiClientError(error);
  if (error.digest === undefined || normalized.requestId !== undefined) {
    return normalized;
  }
  return new ApiClientError({
    code: normalized.code,
    message: normalized.message,
    retryable: normalized.retryable,
    requestId: error.digest,
    ...(normalized.registry === undefined
      ? {}
      : { registry: normalized.registry }),
    ...(normalized.registryCode === undefined
      ? {}
      : { registryCode: normalized.registryCode }),
    details: normalized.details,
  });
}

export default function AppError({
  error,
  retry,
}: {
  error: BoundaryError;
  retry: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <TopBar />
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <EmptyState
          body="アプリを再読み込みしてください。ローカルの情報は変更されていません。"
          className="max-w-120"
          primary={
            <Button
              leadingIcon={<RefreshCw />}
              onClick={retry}
              variant="outline"
            >
              再読み込み
            </Button>
          }
          title="エラーが発生しました"
          tone="warn"
        />
        <ErrorCard
          className="max-w-120"
          error={normalize(error)}
          showLogsLink
        />
      </div>
    </div>
  );
}
