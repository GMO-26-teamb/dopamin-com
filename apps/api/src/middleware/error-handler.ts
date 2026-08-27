import { RegistryError } from "@dopamin/registry";
import type { ApiError, ErrorCode, RegistryId } from "@dopamin/shared";
import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ApiException } from "../lib/errors";
import {
  REGISTRY_ERROR_HTTP,
  registryErrorMessage,
} from "../lib/registry-message";
import type { AppEnv } from "../types";

function errorBody(options: {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  requestId: string;
  registry?: RegistryId;
  registryCode?: number;
  details?: unknown;
}): ApiError {
  return {
    error: {
      code: options.code,
      message: options.message,
      retryable: options.retryable,
      ...(options.registry ? { registry: options.registry } : {}),
      ...(options.registryCode !== undefined
        ? { registryCode: String(options.registryCode) }
        : {}),
      requestId: options.requestId,
      ...(options.details !== undefined ? { details: options.details } : {}),
    },
  };
}

/** HTTPException（Hono / バリデータ由来）のステータス → 統一コード。無ければ INTERNAL。 */
const CODE_FOR_STATUS: Record<number, ErrorCode> = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  429: "RATE_LIMITED",
};

/** 例外を統一エラー形式（§10.3）に変換する。想定外エラーは 500 + requestId。 */
export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  const requestId = c.get("requestId") ?? "unknown";

  // 業務エラーは ApiException の 1 経路（status は ERROR_STATUS から導出済み）
  if (err instanceof ApiException) {
    return c.json(
      errorBody({
        code: err.code,
        message: err.message,
        retryable: err.retryable,
        requestId,
        details: err.details,
      }),
      err.status,
    );
  }

  if (err instanceof RegistryError) {
    // レジストリの生テキスト（message / reason）はサーバーログにのみ残し、
    // クライアントには正規化済みの情報だけ返す（spec-notes: reason を UI に出さない）
    console.error(
      JSON.stringify({
        level: "warn",
        requestId,
        registry: err.registry,
        code: err.code,
        registryCode: err.registryCode,
        message: err.message,
        reason: err.reason,
      }),
    );
    return c.json(
      errorBody({
        code: err.code,
        message: registryErrorMessage(err),
        retryable: err.retryable,
        requestId,
        registry: err.registry,
        registryCode: err.registryCode,
      }),
      REGISTRY_ERROR_HTTP[err.code],
    );
  }

  if (err instanceof HTTPException) {
    // Hono / バリデータ由来の HTTPException（不正 JSON の 400 等）も統一コードに寄せる
    return c.json(
      errorBody({
        code: CODE_FOR_STATUS[err.status] ?? "INTERNAL",
        message: err.message || "リクエストを処理できませんでした。",
        retryable: false,
        requestId,
      }),
      err.status,
    );
  }

  // 想定外エラー: 構造化ログに残して 500 を返す（NFR-06）
  console.error(
    JSON.stringify({
      level: "error",
      requestId,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }),
  );
  return c.json(
    errorBody({
      code: "INTERNAL",
      message: "サーバー内部でエラーが発生しました。",
      retryable: false,
      requestId,
    }),
    500,
  );
};

/** 未定義ルートも統一エラー形式で返す。 */
export const notFoundHandler: NotFoundHandler<AppEnv> = (c) => {
  return c.json(
    errorBody({
      code: "NOT_FOUND",
      message: "指定されたリソースが見つかりません。",
      retryable: false,
      requestId: c.get("requestId") ?? "unknown",
    }),
    404,
  );
};
