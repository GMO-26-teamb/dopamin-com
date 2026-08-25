import type { RegistryId } from "@dopamin/shared";
import { z } from "zod";
import { errorCodeForEppResult, RegistryError } from "./errors";

/**
 * レジストリ共通のレスポンスエンベロープ（docs/registry/spec-notes.md「レスポンスエンベロープ」）。
 * Swagger 本文の例は `msg` だが実際は `message` を返す（実測済み）ため `message` を必須にする。
 * 未知フィールドは許容し、必須フィールド欠落は REGISTRY_SPEC_MISMATCH にする（§11.1）。
 */
export const eppResultSchema = z.looseObject({
  code: z.number().int(),
  message: z.string(),
  reason: z.string().nullish(),
  extValue: z.unknown().nullish(),
});

export const eppEnvelopeSchema = z.looseObject({
  result: eppResultSchema,
  resData: z.unknown().nullish(),
  extension: z.unknown().nullish(),
  trID: z.looseObject({
    clTRID: z.string().nullish(),
    svTRID: z.string(),
  }),
});

export type EppEnvelope = z.infer<typeof eppEnvelopeSchema>;

/** 業務成功とみなす EPP result code（1000 = 成功, 1001 = 受理・処理保留）。 */
export const EPP_SUCCESS_CODES: ReadonlySet<number> = new Set([1000, 1001]);

export interface InterpretInput {
  registry: RegistryId;
  /** 呼び出したコマンド名（エラーメッセージ用）。 */
  command: string;
  httpStatus: number;
  /** JSON.parse 済みのレスポンスボディ。parse 失敗時は undefined を渡す。 */
  json: unknown;
  /** JSON でなかった場合の生ボディ先頭（診断用）。 */
  rawSnippet?: string;
}

export interface InterpretSuccess {
  envelope: EppEnvelope;
}

/**
 * HTTP ステータスと EPP result code の 2 段判定を行い、成功エンベロープを返す。
 * 失敗はすべて RegistryError に正規化して投げる。
 */
export function interpretEppResponse(input: InterpretInput): InterpretSuccess {
  const { registry, command, httpStatus, json } = input;
  const httpOk = httpStatus >= 200 && httpStatus < 300;

  if (json === undefined) {
    // JSON ですらない応答。ゲート認証失敗（401/403 の HTML 等）や 5xx を想定。
    throw new RegistryError({
      code: httpOk ? "REGISTRY_SPEC_MISMATCH" : "REGISTRY_UNAVAILABLE",
      registry,
      message: `${command}: レジストリ応答を JSON として解釈できません (HTTP ${httpStatus})`,
      httpStatus,
      reason: input.rawSnippet,
    });
  }

  const parsed = eppEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    throw new RegistryError({
      code: httpOk ? "REGISTRY_SPEC_MISMATCH" : "REGISTRY_UNAVAILABLE",
      registry,
      message: `${command}: レスポンスエンベロープが仕様と一致しません (HTTP ${httpStatus})`,
      httpStatus,
      reason: parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    });
  }

  const envelope = parsed.data;
  const resultCode = envelope.result.code;

  if (!EPP_SUCCESS_CODES.has(resultCode)) {
    throw new RegistryError({
      code: errorCodeForEppResult(resultCode),
      registry,
      message: `${command}: レジストリがコマンドを拒否しました (result ${resultCode}: ${envelope.result.message})`,
      registryCode: resultCode,
      reason: envelope.result.reason ?? undefined,
      httpStatus,
    });
  }

  if (!httpOk) {
    // result は成功なのに HTTP がエラー — 仕様と食い違っている
    throw new RegistryError({
      code: "REGISTRY_SPEC_MISMATCH",
      registry,
      message: `${command}: HTTP ${httpStatus} なのに result ${resultCode} が返りました`,
      registryCode: resultCode,
      httpStatus,
    });
  }

  return { envelope };
}

/**
 * 成功エンベロープの resData をコマンド別スキーマで検証する。
 * 欠落・型不一致は REGISTRY_SPEC_MISMATCH（仕様変更の疑い）。
 */
export function parseResData<T>(
  registry: RegistryId,
  command: string,
  envelope: EppEnvelope,
  schema: z.ZodType<T>,
): T {
  const parsed = schema.safeParse(envelope.resData);
  if (!parsed.success) {
    throw new RegistryError({
      code: "REGISTRY_SPEC_MISMATCH",
      registry,
      message: `${command}: resData が仕様と一致しません`,
      reason: parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    });
  }
  return parsed.data;
}
