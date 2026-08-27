/**
 * クライアント側の統一エラー（fe-ui 設計 §4.3）。
 *
 * API の統一エラー形式（docs/requirements.md §10.3）に、フロント固有の 2 コードを足す。
 * - `NOT_IMPLEMENTED`: API 未実装のルートを HTTP 実装が呼んだとき
 * - `NETWORK`: fetch 自体が失敗したとき（オフライン・DNS 失敗など）
 */

import {
  apiErrorSchema,
  type ErrorCode,
  errorCodeSchema,
  type RegistryId,
} from "@dopamin/shared";

export type ClientErrorCode = ErrorCode | "NOT_IMPLEMENTED" | "NETWORK";

/**
 * 失敗した相手。`REGISTRY_TIMEOUT` / `REGISTRY_UNAVAILABLE` は AI 呼び出しでも使うため、
 * 文言（`lib/error-messages.ts`）を出し分けるのに使う（ui-screens S-23 / S-41）。
 * 既定は未指定 = どちらとも言わない（レジストリ寄りの文言になる）。
 */
export type ErrorOrigin = "registry" | "ai";

export interface ApiClientErrorInit {
  code: ClientErrorCode;
  message: string;
  retryable?: boolean;
  origin?: ErrorOrigin;
  registry?: RegistryId;
  registryCode?: string;
  requestId?: string;
  details?: unknown;
}

/** `retryable` が明示されなかったときの既定（§10.3 の HTTP ステータスに準じる）。 */
const RETRYABLE_BY_DEFAULT: ReadonlySet<ClientErrorCode> =
  new Set<ClientErrorCode>([
    "REGISTRY_TIMEOUT",
    "REGISTRY_UNAVAILABLE",
    "AI_UNAVAILABLE",
    "RATE_LIMITED",
    "INTERNAL",
    "NETWORK",
  ]);

export class ApiClientError extends Error {
  readonly code: ClientErrorCode;
  readonly retryable: boolean;
  readonly origin: ErrorOrigin | undefined;
  readonly registry: RegistryId | undefined;
  readonly registryCode: string | undefined;
  readonly requestId: string | undefined;
  readonly details: unknown;

  constructor(init: ApiClientErrorInit) {
    super(init.message);
    this.name = "ApiClientError";
    this.code = init.code;
    this.retryable = init.retryable ?? RETRYABLE_BY_DEFAULT.has(init.code);
    this.origin = init.origin;
    this.registry = init.registry;
    this.registryCode = init.registryCode;
    this.requestId = init.requestId;
    this.details = init.details;
  }
}

/** 未実装の API ルートを呼んだときの定型エラー（HTTP 実装が使う）。 */
export function notImplemented(
  route: string,
  origin?: ErrorOrigin,
): ApiClientError {
  return new ApiClientError({
    code: "NOT_IMPLEMENTED",
    message: `${route} はまだ実装されていません。`,
    retryable: false,
    ...(origin === undefined ? {} : { origin }),
  });
}

/** ApiRequestError（lib/webauthn.ts）の形かどうか。 */
function isApiRequestErrorLike(
  value: unknown,
): value is { name: string; code: string; message: string } {
  return (
    value instanceof Error &&
    value.name === "ApiRequestError" &&
    "code" in value &&
    typeof (value as { code: unknown }).code === "string"
  );
}

/**
 * 何を投げられても `ApiClientError` に正規化する。
 * `ApiRequestError`（既存の lib/webauthn.ts）/ §10.3 のレスポンスボディ / 素の Error を吸収する。
 *
 * `origin` は「失敗した相手」を呼び出し側が知っている場合に渡す（AI 経路なら `"ai"`）。
 * API の統一エラー形式は相手を持たないので、`REGISTRY_TIMEOUT` などの共用コードを
 * AI 向けの文言に振り分けるにはここで補うしかない（ui-screens S-23 / S-41）。
 * 既に `ApiClientError` なものは自分で相手を知っているとみなして上書きしない。
 */
export function toApiClientError(
  e: unknown,
  origin?: ErrorOrigin,
): ApiClientError {
  if (e instanceof ApiClientError) {
    return e;
  }
  const withOrigin = origin === undefined ? {} : { origin };

  // §10.3 の統一エラー形式（fetch で読んだ JSON をそのまま渡せる）
  const body = apiErrorSchema.safeParse(e);
  if (body.success) {
    const { error } = body.data;
    return new ApiClientError({
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...withOrigin,
      ...(error.registry === undefined ? {} : { registry: error.registry }),
      ...(error.registryCode === undefined
        ? {}
        : { registryCode: error.registryCode }),
      ...(error.requestId === undefined ? {} : { requestId: error.requestId }),
      details: error.details,
    });
  }

  if (isApiRequestErrorLike(e)) {
    const code = errorCodeSchema.safeParse(e.code);
    return new ApiClientError({
      code: code.success ? code.data : "INTERNAL",
      message: e.message,
      ...withOrigin,
    });
  }

  // fetch のネットワーク失敗は TypeError で来る
  if (e instanceof TypeError) {
    return new ApiClientError({
      code: "NETWORK",
      message: "通信に失敗しました。",
      ...withOrigin,
    });
  }

  return new ApiClientError({
    code: "INTERNAL",
    message: e instanceof Error ? e.message : "エラーが発生しました。",
    ...withOrigin,
  });
}
