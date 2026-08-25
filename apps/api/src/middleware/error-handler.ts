import { RegistryError, type RegistryErrorCode } from "@dopamin/registry";
import type { ApiErrorBody, ApiErrorCode, RegistryId } from "@dopamin/shared";
import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ApiError } from "../lib/api-error";
import { ApiException } from "../lib/errors";
import type { AppEnv } from "../types";

const REGISTRY_DISPLAY_NAMES: Record<RegistryId, string> = {
  kitaqsign: "Kitaqsign",
  kitaqnic: "Kitaqnic",
  mock: "Mock レジストリ",
};

/** RegistryError → HTTP ステータス（docs/requirements.md §10.3）。 */
const REGISTRY_ERROR_HTTP: Record<RegistryErrorCode, ContentfulStatusCode> = {
  NOT_FOUND: 404,
  CONFLICT: 409,
  OPERATION_NOT_ALLOWED: 409,
  REGISTRY_REJECTED: 422,
  REGISTRY_TIMEOUT: 504,
  REGISTRY_UNAVAILABLE: 502,
  REGISTRY_SPEC_MISMATCH: 502,
};

/** RegistryError → ユーザー向けメッセージ（FR-18）。技術詳細は details に退避する。 */
function registryErrorMessage(err: RegistryError): string {
  const name = REGISTRY_DISPLAY_NAMES[err.registry];
  switch (err.code) {
    case "REGISTRY_TIMEOUT":
      return `${name} が応答しませんでした。しばらくして再試行してください。`;
    case "REGISTRY_UNAVAILABLE":
      return `${name} に接続できません。しばらくして再試行してください。`;
    case "REGISTRY_SPEC_MISMATCH":
      return `${name} の応答が想定と異なります（レジストリの仕様変更の可能性があります）。`;
    case "REGISTRY_REJECTED":
      return `${name} がリクエストを拒否しました。入力内容を確認してください。`;
    case "NOT_FOUND":
      return "対象のドメインが見つかりません。";
    case "CONFLICT":
      return "対象は既に存在します。";
    case "OPERATION_NOT_ALLOWED":
      return "現在のステータスではこの操作はできません。";
  }
}

function errorBody(options: {
  code: ApiErrorCode;
  message: string;
  retryable: boolean;
  requestId: string;
  registry?: RegistryId;
  registryCode?: number;
  details?: unknown;
}): ApiErrorBody {
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

/** 例外を統一エラー形式（§10.3）に変換する。想定外エラーは 500 + requestId。 */
export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  const requestId = c.get("requestId") ?? "unknown";

  if (err instanceof ApiException) {
    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
          retryable: false,
          requestId,
          ...(err.details ? { details: err.details } : {}),
        },
      },
      err.status,
    );
  }

  if (err instanceof ApiError) {
    return c.json(
      errorBody({
        code: err.code,
        message: err.message,
        retryable: false,
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
    const codeForStatus: Record<number, ApiErrorCode> = {
      400: "VALIDATION_ERROR",
      401: "UNAUTHORIZED",
      403: "FORBIDDEN",
      404: "NOT_FOUND",
      409: "CONFLICT",
      429: "RATE_LIMITED",
    };
    return c.json(
      errorBody({
        code: codeForStatus[err.status] ?? "INTERNAL",
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
