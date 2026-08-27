/**
 * AI 機能・プロバイダの語彙と、AI 設定 / デモリセットの API 契約
 * （docs/requirements.md §9.1 ai_logs / §10.1 `PATCH /settings/ai`・`POST /demo/reset` / FR-14・FR-16・FR-17）。
 *
 * API キーはサーバー側（`apps/api` の環境変数）だけが持ち、ここには一切現れない（FR-17）。
 */

import { z } from "zod";
import { domainNameSchema } from "./domain-name";

/** AI を使う機能（`ai_logs.feature`、docs/requirements.md §9.1 / FR-04・FR-05・FR-13）。 */
export const AI_FEATURES = [
  "domain_candidates",
  "uniqueness",
  "subdomain_plan",
] as const;

export const aiFeatureSchema = z.enum(AI_FEATURES);
export type AiFeature = z.infer<typeof aiFeatureSchema>;

/**
 * 選択できる LLM プロバイダ（FR-17）。
 * 実際に選べるのは環境変数で有効化されたものだけで、その一覧は
 * {@link aiSettingsSchema} の `providers` としてサーバーから配られる。
 *
 * 並び順はフォールバック先の優先順でもある（§13.1「失敗したら 1 回だけ別プロバイダ」は
 * 本命以外の先頭 1 件を取る）。`xai` は Gateway 経由専用で、`AI_GATEWAY_API_KEY` が
 * 無い環境では選択肢に出ない（`docs/specs/ai-gateway.md` §2.6）。
 */
export const AI_PROVIDERS = ["google", "anthropic", "xai"] as const;

export const aiProviderSchema = z.enum(AI_PROVIDERS);
export type AiProvider = z.infer<typeof aiProviderSchema>;

/** AI ログの結果種別（`ai_logs.status`）。成功・失敗を問わず記録する（AC-14-1）。 */
export const AI_LOG_STATUSES = ["success", "error"] as const;

export const aiLogStatusSchema = z.enum(AI_LOG_STATUSES);
export type AiLogStatus = z.infer<typeof aiLogStatusSchema>;

/** モデル名（`gemini-2.5-flash` 等）。プロバイダごとに増えるため enum にはしない。 */
export const aiModelSchema = z.string().trim().min(1).max(100);

/** 有効化されているプロバイダと、そのプロバイダで選べるモデル（FR-17 の選択肢）。 */
export const aiProviderOptionSchema = z.object({
  id: aiProviderSchema,
  models: z.array(aiModelSchema).min(1),
});
export type AiProviderOption = z.infer<typeof aiProviderOptionSchema>;

/**
 * 現在の AI 設定と選択肢（FR-17）。
 * `provider` / `model` はユーザー設定（`users.ai_provider` / `ai_model`）が
 * 無ければ環境変数の既定値で埋めた「実効値」を返す。
 */
export const aiSettingsSchema = z.object({
  provider: aiProviderSchema,
  model: aiModelSchema,
  providers: z.array(aiProviderOptionSchema),
});
export type AiSettings = z.infer<typeof aiSettingsSchema>;

/** `PATCH /settings/ai` の入力（FR-17）。API キーはユーザーから受け取らない。 */
export const aiSettingsUpdateRequestSchema = z.object({
  provider: aiProviderSchema,
  model: aiModelSchema,
});
export type AiSettingsUpdateRequest = z.infer<
  typeof aiSettingsUpdateRequestSchema
>;

/** `PATCH /settings/ai` のレスポンス（更新後の実効設定をそのまま返す）。 */
export const aiSettingsResponseSchema = aiSettingsSchema;
export type AiSettingsResponse = AiSettings;

/**
 * `POST /demo/reset` のレスポンス（FR-16）。
 * `domains` は投入し直したデモ用ドメイン名（画面の完了バナーで件数・名前を出す）。
 * `DEMO_RESET_ENABLED=false` の環境では実行自体が拒否されるため、成功応答に真偽値は持たせない（AC-16-1）。
 */
export const demoResetResponseSchema = z.object({
  ok: z.literal(true),
  domains: z.array(domainNameSchema),
});
export type DemoResetResponse = z.infer<typeof demoResetResponseSchema>;

/** 入力要約 / 出力要約の最大長（`ai_logs.input_summary` は 200 字以内、§9.1）。 */
export const AI_SUMMARY_MAX_LENGTH = 200;

/**
 * AI ログ用の要約文字列を作る（AC-14-2: プロンプト全文は保存しない）。
 *
 * 文字列はそのまま、それ以外は JSON 化してから空白を 1 つに畳み、
 * `maxLength` を超える場合は末尾を `…` にして切り詰める。
 * API（保存時）と Web（表示時）で同じ結果になるよう `packages/shared` に置く。
 */
export function summarizeForAiLog(
  value: unknown,
  maxLength: number = AI_SUMMARY_MAX_LENGTH,
): string {
  const text = typeof value === "string" ? value : stringify(value);
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  return `${collapsed.slice(0, Math.max(0, maxLength - 1))}…`;
}

function stringify(value: unknown): string {
  if (value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    // 循環参照など JSON 化できない値。要約なので型名だけ残す
    return String(value);
  }
}

/**
 * 入出力トークン数の合計（画面の「トークン数」表示に使う）。
 * どちらも取得できなかった場合だけ `null`（= 非表示）を返す。
 */
export function aiTokenTotal(
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
): number | null {
  if (tokensIn == null && tokensOut == null) {
    return null;
  }
  return (tokensIn ?? 0) + (tokensOut ?? 0);
}
