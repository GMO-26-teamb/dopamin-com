"use client";

/**
 * アプリ全体のプロバイダ（fe-ui 設計 §4.5）。
 *
 * TanStack Query + `Services` + `TooltipProvider`（components/ui）をまとめる。
 * 参照系は自動再試行 2 回（指数バックオフ）まで。再試行しても意味の無いエラー
 * （`NOT_IMPLEMENTED` / 4xx 相当）は `ApiClientError.retryable` で弾く（ui-screens §4）。
 *
 * どの画面のクエリ / ミューテーションでも 401（`UNAUTHORIZED`）を受けたら
 * `/login?reason=expired&next=<現在のパス>` へ送る（ui-screens §1・S-03）。
 */

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { safeNextPath } from "@/features/auth/next-path";
import { ApiClientError } from "./errors";
import { API_MODE } from "./mode";
import { ServicesProvider } from "./provider";
import type { Services } from "./services";

const MAX_QUERY_RETRIES = 2;

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) {
    return false;
  }
  return error instanceof ApiClientError ? error.retryable : true;
}

/**
 * セッション切れの戻り先つきログイン URL（ui-screens §1）。
 * 現在地は `safeNextPath` に通す（`/login` `/` は `next` を付けない = ループ防止）。
 */
export function expiredLoginUrl(currentPath: string): string {
  const next = safeNextPath(currentPath);
  return next === null
    ? "/login?reason=expired"
    : `/login?reason=expired&next=${encodeURIComponent(next)}`;
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "UNAUTHORIZED";
}

export interface CreateQueryClientOptions {
  /**
   * 401 → ログイン画面の誘導を有効にするか。
   * 既定は http モードのみ（モックはセッションを持たないので、`?mock=` の
   * エラーシナリオが画面ごと乗っ取られないようにする）。
   */
  redirectOnUnauthorized?: boolean;
  /** 遷移の実装。既定は `window.location.assign`（テストから差し替える）。 */
  navigate?: (url: string) => void;
}

function assignLocation(url: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.location.assign(url);
}

export function createQueryClient(
  options: CreateQueryClientOptions = {},
): QueryClient {
  const enabled = options.redirectOnUnauthorized ?? API_MODE === "http";
  const navigate = options.navigate ?? assignLocation;
  // 同時に走った複数のクエリが 401 になっても遷移は 1 回だけ
  let redirected = false;

  const onError = (error: unknown): void => {
    if (!enabled || redirected || !isUnauthorized(error)) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    const { pathname, search, hash } = window.location;
    redirected = true;
    navigate(expiredLoginUrl(`${pathname}${search}${hash}`));
  };

  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
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
        <TooltipProvider>{props.children}</TooltipProvider>
      </ServicesProvider>
    </QueryClientProvider>
  );
}
