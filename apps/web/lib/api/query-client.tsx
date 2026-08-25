"use client";

/**
 * アプリ全体のプロバイダ（fe-ui 設計 §4.5）。
 *
 * TanStack Query + `Services` + radix の Tooltip Provider をまとめる。
 * 参照系は自動再試行 2 回（指数バックオフ）まで。再試行しても意味の無いエラー
 * （`NOT_IMPLEMENTED` / 4xx 相当）は `ApiClientError.retryable` で弾く（ui-screens §4）。
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Tooltip } from "radix-ui";
import type { ReactNode } from "react";
import { useState } from "react";
import { ApiClientError } from "./errors";
import { ServicesProvider } from "./provider";
import type { Services } from "./services";

const MAX_QUERY_RETRIES = 2;

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) {
    return false;
  }
  return error instanceof ApiClientError ? error.retryable : true;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 画面遷移のたびに叩き直さない。最新化は「再同期」ボタン（refetch）で行う
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: shouldRetry,
      },
      // 更新系は自動再試行しない（二重実行を避ける・FR-18）
      mutations: { retry: false },
    },
  });
}

export function AppProviders(props: {
  children: ReactNode;
  services?: Services;
}) {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ServicesProvider
        {...(props.services ? { services: props.services } : {})}
      >
        <Tooltip.Provider delayDuration={200}>
          {props.children}
        </Tooltip.Provider>
      </ServicesProvider>
    </QueryClientProvider>
  );
}
