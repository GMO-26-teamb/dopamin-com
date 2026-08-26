import { type Db, schema } from "@dopamin/db";
import {
  AI_PROVIDERS,
  type AiProvider,
  type AiProviderOption,
  type AiSettings,
  type AiSettingsUpdateRequest,
} from "@dopamin/shared";
import { eq } from "drizzle-orm";
import { type ApiEnv, getApiEnv } from "../lib/env";
import { ApiException } from "../lib/errors";

/**
 * AI 設定（FR-17 / docs/requirements.md §13.1 / docs/specs/passkey-auth.md §12.3）。
 *
 * - 有効プロバイダ = 環境変数に API キーがあるもの。どのキーも無ければ `AI_PROVIDER` を唯一の
 *   選択肢にする（ローカル開発で設定画面が空にならないように）。
 * - 候補モデル = `AI_MODEL`（そのプロバイダが `AI_PROVIDER` のとき）を先頭に、既知モデルの短いリスト。
 * - 実効値 = `users.ai_provider / ai_model` → env 既定の順。保存済みプロバイダが無効化されていれば
 *   既定に倒す（キーを外した環境で壊れないように）。
 * API キーの値はここから外に出さない（有無だけを見る。NFR-03）。
 */

/** プロバイダごとの既知モデル（先頭が既定）。ID は `aiModelSchema`（1〜100 文字）の範囲内。 */
const KNOWN_MODELS: Record<AiProvider, readonly [string, ...string[]]> = {
  google: ["gemini-2.5-flash", "gemini-2.5-pro"],
  anthropic: ["claude-sonnet-4-5", "claude-haiku-4-5"],
};

/** 内部用: `models` が空でないことを型で保証した選択肢（`AiProviderOption` に代入可能）。 */
interface ProviderOption {
  id: AiProvider;
  models: [string, ...string[]];
}

function hasApiKey(provider: AiProvider, env: ApiEnv): boolean {
  switch (provider) {
    case "google":
      return env.GOOGLE_GENERATIVE_AI_API_KEY !== undefined;
    case "anthropic":
      return env.ANTHROPIC_API_KEY !== undefined;
  }
}

function providerOption(id: AiProvider, env: ApiEnv): ProviderOption {
  const known = KNOWN_MODELS[id];
  const configured = env.AI_PROVIDER === id ? env.AI_MODEL : undefined;
  if (configured === undefined) {
    return { id, models: [...known] };
  }
  return {
    id,
    models: [configured, ...known.filter((model) => model !== configured)],
  };
}

function providerOptions(env: ApiEnv): ProviderOption[] {
  const enabled = AI_PROVIDERS.filter((id) => hasApiKey(id, env));
  const ids: readonly AiProvider[] =
    enabled.length > 0 ? enabled : [env.AI_PROVIDER];
  return ids.map((id) => providerOption(id, env));
}

/** 環境変数で有効化されたプロバイダと候補モデル（`GET /auth/me` の `ai.providers`）。 */
export function enabledAiProviders(env: ApiEnv): AiProviderOption[] {
  return providerOptions(env);
}

/** ユーザー設定 → env 既定の順で実効値を決める。 */
export function resolveAiSettings(
  user: { aiProvider: string | null; aiModel: string | null },
  env: ApiEnv,
): AiSettings {
  const providers = providerOptions(env);
  const chosen = providers.find((option) => option.id === user.aiProvider);
  if (chosen !== undefined) {
    const model =
      user.aiModel !== null && user.aiModel !== ""
        ? user.aiModel
        : chosen.models[0];
    return { provider: chosen.id, model, providers };
  }
  const fallback =
    providers.find((option) => option.id === env.AI_PROVIDER) ??
    providers[0] ??
    providerOption(env.AI_PROVIDER, env);
  return { provider: fallback.id, model: fallback.models[0], providers };
}

/** `users` 行を id で引いて実効値を返す（`GET /auth/me`）。 */
export async function getAiSettingsForUser(
  db: Db,
  userId: string,
  env: ApiEnv,
): Promise<AiSettings> {
  const rows = await db
    .select({
      aiProvider: schema.users.aiProvider,
      aiModel: schema.users.aiModel,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    // セッションはあるのにユーザー行が無い（削除済み等）
    throw new ApiException(
      "UNAUTHORIZED",
      "セッションが無効です。もう一度ログインしてください。",
    );
  }
  return resolveAiSettings(row, env);
}

/**
 * `PATCH /settings/ai`。有効化されていないプロバイダは `VALIDATION_ERROR`（FR-17）。
 * モデルは zod（`aiModelSchema`）で非空を保証済みなので、候補に無くても受け付ける。
 */
export async function updateAiSettings(
  db: Db,
  userId: string,
  input: AiSettingsUpdateRequest,
): Promise<AiSettings> {
  const env = getApiEnv();
  const enabled = providerOptions(env);
  if (!enabled.some((option) => option.id === input.provider)) {
    throw new ApiException(
      "VALIDATION_ERROR",
      "このプロバイダは有効化されていません。",
      {
        provider: input.provider,
        enabledProviders: enabled.map((option) => option.id),
      },
    );
  }
  const rows = await db
    .update(schema.users)
    .set({ aiProvider: input.provider, aiModel: input.model })
    .where(eq(schema.users.id, userId))
    .returning({
      aiProvider: schema.users.aiProvider,
      aiModel: schema.users.aiModel,
    });
  const row = rows[0];
  if (!row) {
    throw new ApiException(
      "UNAUTHORIZED",
      "セッションが無効です。もう一度ログインしてください。",
    );
  }
  return resolveAiSettings(row, env);
}
