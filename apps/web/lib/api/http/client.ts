/**
 * Hono RPC クライアントと応答の検証（fe-ui 設計 §4.6）。
 *
 * ブラウザは同一オリジンの `/api/*` だけを叩き、`next.config.ts` の rewrites が API に転送する
 * （docs/requirements.md §6.3）。応答は必ず zod で検証してから ViewModel に写像する。
 */

import type { AppType } from "@dopamin/api";
import {
  domainAvailabilitySchema,
  domainCandidatesResponseSchema,
  domainListResponseSchema,
  type domainSummarySchema,
  domainSyncResponseSchema,
  domainUniquenessSchema,
  errorCodeSchema,
  registryIdSchema,
  transferResponseSchema,
  transferSummarySchema,
  transfersListResponseSchema,
} from "@dopamin/shared";
import { hc } from "hono/client";
import { z } from "zod";
import { ApiClientError, type ErrorOrigin, toApiClientError } from "../errors";

/** 同一オリジン（`""`）の `/api/v1/*` を叩く RPC クライアント。 */
export const apiClient = hc<AppType>("");

/**
 * 応答を受け取り、エラーなら `ApiClientError`、成功ならスキーマ検証済みの JSON を返す。
 * fetch 自体の失敗は `NETWORK`、成功応答のスキーマ不一致は `INTERNAL` にする。
 *
 * `origin` は「失敗した相手」（AI ルートなら `"ai"`）。`REGISTRY_TIMEOUT` /
 * `REGISTRY_UNAVAILABLE` は AI 呼び出しでも返るため、文言の出し分けに使う。
 */
export async function unwrap<T>(
  request: Promise<Response>,
  schema: z.ZodType<T>,
  origin?: ErrorOrigin,
): Promise<T> {
  let response: Response;
  try {
    response = await request;
  } catch (e) {
    throw toApiClientError(e, origin);
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw toApiClientError(
      body ?? new Error(`HTTP ${response.status} が返りました。`),
      origin,
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // 200 が返ったのに形が違うのは自前 API 側の問題。REGISTRY_SPEC_MISMATCH は
    // 「レジストリの仕様変更」を指す文言なのでレジストリのせいにしない。
    throw new ApiClientError({
      code: "INTERNAL",
      message: "API の応答が想定した形式ではありませんでした。",
      details: parsed.error.issues,
    });
  }
  return parsed.data;
}

export type {
  DomainDetailResponse as DomainEnvelope,
  DomainInfoResponse,
} from "@dopamin/shared";
/**
 * 詳細・更新系・廃止の応答スキーマ。すべて packages/shared が SSOT（#53）。
 * ここで別に定義すると API とワイヤ形式が二重定義になるため re-export に寄せる。
 */
export {
  domainDeleteResponseSchema as nullableDomainEnvelopeSchema,
  domainDetailResponseSchema as domainEnvelopeSchema,
  domainInfoSchema,
} from "@dopamin/shared";

/** 一覧・同期（FR-02）。スキーマは packages/shared が SSOT。 */
export const domainListSchema = domainListResponseSchema;
export const domainSyncSchema = domainSyncResponseSchema;
export type ApiDomainSummary = z.infer<typeof domainSummarySchema>;

export const authCodeSchema = z.object({
  authCode: z.string(),
  rotated: z.boolean().optional(),
});

/** `POST /domains/check` の 1 件分（§10.4）。 */
export const checkResponseSchema = z.object({
  results: z.array(
    z.object({
      name: z.string(),
      registry: registryIdSchema.nullable(),
      availability: domainAvailabilitySchema,
      reason: z.string().optional(),
      // FR-05: available の行に付く（unavailable / error は null。§10.4）
      uniqueness: domainUniquenessSchema.nullable(),
      error: z
        .object({ code: errorCodeSchema, message: z.string() })
        .optional(),
    }),
  ),
});

/**
 * `POST /ai/domain-candidates` の応答（FR-04 / §10.1）。
 * スキーマは packages/shared が SSOT（3 層のうちクライアント向けの応答層）。
 */
export const candidatesResponseSchema = domainCandidatesResponseSchema;

/**
 * `POST /transfers` の応答（FR-12 / §10.1）。
 * `transfer` はレジストリ応答の DTO（`raw` は API 境界で落ちる）、`record` は
 * 永続化された `transfers` 行の要約（#56）。以後の取消・照会は `record.id`（uuid）で行う。
 */
export const transferEnvelopeSchema = z.object({
  transfer: transferResponseSchema,
  record: transferSummarySchema,
});

/** `GET /transfers` の応答（FR-12）。スキーマは packages/shared が SSOT。 */
export const transfersListSchema = transfersListResponseSchema;

/** `POST /transfers/:id/{approve,reject,cancel}` / `GET /transfers/:id` の応答。 */
export const transferSummaryEnvelopeSchema = z.object({
  transfer: transferSummarySchema,
});
