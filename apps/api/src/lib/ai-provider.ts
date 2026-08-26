import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { Db } from "@dopamin/db";
import type { AiFeature, AiProvider, AiSettings } from "@dopamin/shared";
import {
  APICallError,
  generateObject,
  type LanguageModel,
  RetryError,
} from "ai";
import type { z } from "zod";
import {
  type AiCallRecord,
  AiLogWriteTimeoutError,
  buildAiLogConsoleLine,
  buildAiLogRow,
  recordAiLog,
} from "../services/ai-log.service";
import {
  aiProviderApiKey,
  getAiSettingsForUser,
  resolveAiSettings,
} from "../services/settings";
import { getDb } from "./db";
import { getApiEnv } from "./env";
import { ApiException } from "./errors";
import { getRequestContext } from "./operation-log-context";

/**
 * 生成 AI のプロバイダ抽象化（docs/requirements.md §13.1 / §13.4 / FR-14 / NFR-05）。
 *
 * - 生成は `generateObject`（zod スキーマ必須）だけ。自由文生成は行わない。
 * - 上限時間は 1 呼び出しあたり合計 10 秒。失敗したら残り予算がある限り 1 回だけ
 *   別プロバイダにフォールバックする（両方有効な場合）。
 * - 出力は必ず zod で再検証してから返す（AI 出力は信用しない）。
 * - 呼び出しは成功・失敗を問わず `ai_logs` に記録する（AC-14-1）。プロンプト全文は保存しない（AC-14-2）。
 * - 失敗は AI_UNAVAILABLE（503）/ RATE_LIMITED（429）の ApiException に変換して投げる（§10.3）。
 *
 * 埋め込み（§13.3 `resolveEmbeddingModel`）は ADR-0003 で不採用になったため実装しない。
 * API キーは apps/api の環境変数だけが持ち、モデル生成時に SDK へ渡すだけ（NFR-03）。
 */

/**
 * `runStructured` 1 回でプロバイダを待つ合計時間の上限（§13.1「タイムアウト 10 秒」）。
 * 本命とフォールバックの合計で、API の応答が 20 秒になるのを避ける
 * （#66 も「10 秒超で AI_UNAVAILABLE」を前提にしている）。
 * `ai_logs` の書き込み待ち（`AI_LOG_WRITE_TIMEOUT_MS`）はこの予算に含めない。
 */
export const AI_CALL_TIMEOUT_MS = 10_000;

/**
 * 残り予算がこれ未満ならフォールバックしない。
 * 本命がタイムアウトで予算を使い切った場合は 2 回目を試さず、速い失敗
 * （429 / 5xx / 出力不正）のときだけ別プロバイダに切り替わる。
 */
export const AI_FALLBACK_MIN_BUDGET_MS = 1_000;

/** 予算を測る対象は AI 呼び出しの実時間だけ（`ai_logs` の書き込み待ちは含めない）。 */

/** 上限時間内に応答が返らなかったことを表す（AI_UNAVAILABLE に変換される）。 */
export class AiCallTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`AI が ${timeoutMs}ms 以内に応答しませんでした`);
    this.name = "AiCallTimeoutError";
  }
}

/** 1 回の試行で使うプロバイダとモデル（`ai_logs.provider` / `model` に入る値）。 */
export interface AiAttempt {
  provider: AiProvider;
  model: string;
}

/** `users` の AI 設定列（§13.1 の `resolveModel(user?)` の引数）。 */
export interface AiUserSettings {
  aiProvider: string | null;
  aiModel: string | null;
}

/** LanguageModel の生成。テストではここを差し替えてプロバイダを呼ばせない。 */
export type AiModelFactory = (attempt: AiAttempt) => LanguageModel;

const defaultModelFactory: AiModelFactory = ({ provider, model }) => {
  const apiKey = aiProviderApiKey(provider, getApiEnv());
  if (apiKey === undefined) {
    // resolveAiSettings は「キーのあるプロバイダ」しか選ばないので、ここに来るのは
    // どのプロバイダのキーも設定されていない環境だけ（機能として使えない = 503）
    throw new ApiException(
      "AI_UNAVAILABLE",
      "AI 機能が利用できません。時間をおいて再度お試しください。",
    );
  }
  switch (provider) {
    case "google":
      return createGoogleGenerativeAI({ apiKey })(model);
    case "anthropic":
      return createAnthropic({ apiKey })(model);
  }
};

let modelFactoryOverride: AiModelFactory | null = null;

/**
 * テスト専用: LanguageModel の生成を差し替える（実プロバイダを呼ばせない）。
 * null で既定に戻す。本番コードからは呼ばない。setDbForTesting と同じ流儀。
 */
export function setAiModelFactoryForTesting(
  factory: AiModelFactory | null,
): void {
  modelFactoryOverride = factory;
}

function createModel(attempt: AiAttempt): LanguageModel {
  return (modelFactoryOverride ?? defaultModelFactory)(attempt);
}

/** ユーザー設定 → env 既定の順で実効値を決める（§13.1）。 */
export function resolveAiAttempt(user?: AiUserSettings | null): AiAttempt {
  const settings = resolveAiSettings(
    { aiProvider: user?.aiProvider ?? null, aiModel: user?.aiModel ?? null },
    getApiEnv(),
  );
  return { provider: settings.provider, model: settings.model };
}

/**
 * `users.ai_provider / ai_model` →（未設定なら）環境変数の既定値で LanguageModel を作る（§13.1）。
 * キーが 1 つも設定されていない環境では AI_UNAVAILABLE（503）。
 */
export function resolveModel(user?: AiUserSettings | null): LanguageModel {
  return createModel(resolveAiAttempt(user));
}

/**
 * 試行順（先頭が本命、2 つ目がフォールバック先）。
 * `settings.providers` は API キーがあるプロバイダだけなので、2 件あるとき
 * ＝両方有効なときにだけフォールバック先が付く（§13.1「両方有効な場合」）。
 */
function attemptOrder(settings: AiSettings): [AiAttempt, ...AiAttempt[]] {
  const primary: AiAttempt = {
    provider: settings.provider,
    model: settings.model,
  };
  const other = settings.providers.find(
    (option) => option.id !== settings.provider,
  );
  const fallbackModel = other?.models[0];
  if (other === undefined || fallbackModel === undefined) {
    return [primary];
  }
  return [primary, { provider: other.id, model: fallbackModel }];
}

export interface RunStructuredOptions {
  /** `ai_logs.user_id`（NOT NULL）と、実効 AI 設定の解決に使う。 */
  user: { id: string };
  /**
   * `ai_logs.input_summary` の素（AC-14-2）。
   * プロンプト全文ではなく、呼び出しの意味的な入力（ニックネーム・ドメイン名など）を渡す。
   * 200 字を超える分は `summarizeForAiLog` が切り詰める。
   */
  input: unknown;
  /** システムプロンプト（§13.2 の `apps/api/src/prompts/<feature>.ts`）。 */
  instructions?: string;
  /** 解決済みの実効設定。省略時は `users` 行から引く（呼び出し側が既に持つなら渡す）。 */
  settings?: AiSettings;
  /** 既定 {@link AI_CALL_TIMEOUT_MS}。 */
  timeoutMs?: number;
  /** 既定 `getDb()`。 */
  db?: Db;
}

/**
 * `generateObject` を上限時間（合計 {@link AI_CALL_TIMEOUT_MS}）内で実行し、失敗したら
 * 残り予算がある限り 1 回だけ別プロバイダへ切り替え、得られた出力を zod で再検証して返す（§13.1）。
 * 試行 1 回につき `ai_logs` へ 1 行、成功・失敗を問わず記録する（AC-14-1）。
 * すべて失敗した場合は AI_UNAVAILABLE（503）/ RATE_LIMITED（429）を投げる。
 *
 * `generateObject` は AI SDK v7 で deprecated（後継は `generateText` + `Output.object`）だが、
 * §13.1 が「生成は generateObject（zod スキーマ必須）」と定めているのでこのまま使う。
 */
export async function runStructured<T>(
  feature: AiFeature,
  schema: z.ZodType<T>,
  prompt: string,
  options: RunStructuredOptions,
): Promise<T> {
  const db = options.db ?? getDb();
  const settings =
    options.settings ??
    (await getAiSettingsForUser(db, options.user.id, getApiEnv()));
  const timeoutMs = options.timeoutMs ?? AI_CALL_TIMEOUT_MS;
  // 予算はプロバイダを待った時間だけを積む。ai_logs の書き込み待ち（最大
  // AI_LOG_WRITE_TIMEOUT_MS）を含めると、DB が遅いだけでフォールバックが消えてしまう
  let aiElapsedMs = 0;

  let lastError: unknown;
  for (const [index, attempt] of attemptOrder(settings).entries()) {
    const budgetMs = timeoutMs - aiElapsedMs;
    if (index > 0 && budgetMs < AI_FALLBACK_MIN_BUDGET_MS) {
      // 本命が予算をほぼ使い切った。2 回目を始めても打ち切るだけなので試さない
      break;
    }
    const startedAt = Date.now();
    try {
      const generated = await callProvider(attempt, schema, prompt, {
        instructions: options.instructions,
        timeoutMs: budgetMs,
      });
      const latencyMs = Date.now() - startedAt;
      aiElapsedMs += latencyMs;
      // AI 出力は信用しない。generateObject の検証とは別に、返す直前でもう一度通す（§13.1）
      const value = schema.parse(generated.object);
      await writeAiLog(db, {
        userId: options.user.id,
        feature,
        provider: attempt.provider,
        model: attempt.model,
        input: options.input,
        output: value,
        tokensIn: generated.usage.inputTokens ?? null,
        tokensOut: generated.usage.outputTokens ?? null,
        latencyMs,
        status: "success",
      });
      return value;
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      aiElapsedMs += latencyMs;
      lastError = error;
      await writeAiLog(db, {
        userId: options.user.id,
        feature,
        provider: attempt.provider,
        model: attempt.model,
        input: options.input,
        tokensIn: null,
        tokensOut: null,
        latencyMs,
        status: "error",
        errorMessage: errorMessageOf(error),
      });
    }
  }
  throw toApiException(lastError);
}

/**
 * 1 プロバイダぶんの `generateObject`。上限時間で AbortController を発火させ、
 * 待ち側も AiCallTimeoutError で打ち切る（HTTP は中断され、呼び出し側は待たされない）。
 */
async function callProvider<T>(
  attempt: AiAttempt,
  schema: z.ZodType<T>,
  prompt: string,
  options: { instructions?: string; timeoutMs: number },
) {
  const model = createModel(attempt);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AiCallTimeoutError(options.timeoutMs));
    }, options.timeoutMs);
  });
  try {
    return await Promise.race([
      generateObject({
        model,
        schema,
        output: "object",
        prompt,
        instructions: options.instructions,
        abortSignal: controller.signal,
        // 再試行は AI SDK 内部ではなく本関数のフォールバック 1 回だけに寄せる
        // （SDK の既定 2 回は 10 秒の予算をプロバイダ 1 つで使い切ってしまう）
        maxRetries: 0,
      }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * console（NFR-06）→ `ai_logs`（§9.1）の順で 1 試行を記録する。
 * console を先に出すのは、INSERT 失敗や serverless の関数フリーズでも Vercel ログには
 * 必ず残すため。記録の失敗は AI 呼び出しの成否に影響させない（registries.ts と同じ流儀）。
 */
async function writeAiLog(db: Db, record: AiCallRecord): Promise<void> {
  const { requestId } = getRequestContext();
  console.log(JSON.stringify(buildAiLogConsoleLine(record, { requestId })));
  try {
    await recordAiLog(db, buildAiLogRow(record));
  } catch (cause) {
    // drizzle の DrizzleQueryError は message に「Failed query: insert … params: <全パラメータ>」を
    // 持ち、そのまま出すと構造化出力が丸ごと Vercel ログに載る。根本原因は cause.cause 側
    const root =
      cause instanceof Error && cause.cause instanceof Error
        ? cause.cause
        : cause;
    console.error(
      JSON.stringify({
        level: "error",
        type: "ai_log_write_failed",
        requestId,
        userId: record.userId,
        feature: record.feature,
        provider: record.provider,
        reason: root instanceof AiLogWriteTimeoutError ? "timeout" : "error",
        errorName: root instanceof Error ? root.name : null,
        message: (root instanceof Error ? root.message : String(root)).slice(
          0,
          300,
        ),
      }),
    );
  }
}

/**
 * AI SDK の再試行ラッパ（RetryError）を剥がして元の失敗を取り出す。
 * `maxRetries: 0` では包まれないが、設定を変えたときに 429 判定が効かなくなるのを防ぐ。
 */
function unwrapRetryError(error: unknown): unknown {
  return RetryError.isInstance(error) ? error.lastError : error;
}

/** 失敗の理由（`ai_logs.error_message` 用）。プロバイダの生文言はここと console にだけ残す。 */
function errorMessageOf(error: unknown): string {
  const cause = unwrapRetryError(error);
  if (APICallError.isInstance(cause)) {
    return cause.statusCode === undefined
      ? cause.message
      : `HTTP ${cause.statusCode}: ${cause.message}`;
  }
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * 統一エラー（§10.3）への変換。
 * プロバイダの 429 だけ RATE_LIMITED（429）で、それ以外の失敗
 * （タイムアウト・5xx・通信断・出力が zod に通らない）はまとめて AI_UNAVAILABLE（503）。
 * どちらも時間をおけば直り得るので retryable。プロバイダの生文言は返さない（NFR-03）。
 */
function toApiException(error: unknown): ApiException {
  if (error instanceof ApiException) {
    return error;
  }
  const cause = unwrapRetryError(error);
  if (APICallError.isInstance(cause) && cause.statusCode === 429) {
    const retryAfter = retryAfterSeconds(cause);
    return new ApiException(
      "RATE_LIMITED",
      "AI の利用制限に達しました。しばらく待ってから再度お試しください。",
      retryAfter === undefined ? undefined : { retryAfter },
      { retryable: true },
    );
  }
  return new ApiException(
    "AI_UNAVAILABLE",
    "AI が一時的に利用できません。しばらく待ってから再度お試しください。",
    undefined,
    { retryable: true },
  );
}

/** `Retry-After`（秒）。秒数以外の形式（HTTP-date）や 0 以下は details に載せない。 */
function retryAfterSeconds(error: APICallError): number | undefined {
  const raw = error.responseHeaders?.["retry-after"];
  if (raw === undefined) {
    return undefined;
  }
  const seconds = Number.parseInt(raw, 10);
  return Number.isInteger(seconds) && seconds > 0 ? seconds : undefined;
}
