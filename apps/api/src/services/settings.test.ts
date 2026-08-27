import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { type ApiEnv, getApiEnv, resetApiEnvCacheForTesting } from "../lib/env";
import { enabledAiProviders, resolveAiSettings } from "./settings";

// このテストが読む環境変数だけをテスト間で確実にリセットする（env.test.ts と同じ流儀）
const AI_KEYS = [
  "AI_PROVIDER",
  "AI_MODEL",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "ANTHROPIC_API_KEY",
  "AI_GATEWAY_API_KEY",
] as const;

type AiKey = (typeof AI_KEYS)[number];

/** process.env を差し替えて ApiEnv を組み立てる。 */
function envWith(vars: Partial<Record<AiKey, string>>): ApiEnv {
  for (const key of AI_KEYS) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
  resetApiEnvCacheForTesting();
  return getApiEnv();
}

beforeEach(() => {
  envWith({});
});

afterAll(() => {
  for (const key of AI_KEYS) {
    delete process.env[key];
  }
  resetApiEnvCacheForTesting();
});

describe("enabledAiProviders（FR-17: 環境変数で有効化されたプロバイダだけ）", () => {
  it("GOOGLE_GENERATIVE_AI_API_KEY だけなら google のみ", () => {
    const env = envWith({ GOOGLE_GENERATIVE_AI_API_KEY: "g-key" });
    expect(enabledAiProviders(env)).toEqual([
      { id: "google", models: ["gemini-2.5-flash", "gemini-2.5-pro"] },
    ]);
  });

  it("両方のキーがあれば AI_PROVIDERS の順（google → anthropic）", () => {
    const env = envWith({
      GOOGLE_GENERATIVE_AI_API_KEY: "g-key",
      ANTHROPIC_API_KEY: "a-key",
    });
    expect(enabledAiProviders(env).map((p) => p.id)).toEqual([
      "google",
      "anthropic",
    ]);
    expect(enabledAiProviders(env)[1]?.models).toEqual([
      "claude-sonnet-4-5",
      "claude-haiku-4-5",
    ]);
  });

  it("どのキーも無ければ AI_PROVIDER を唯一の選択肢にする（ローカル開発で画面が空にならない）", () => {
    expect(enabledAiProviders(envWith({})).map((p) => p.id)).toEqual([
      "google",
    ]);
    expect(
      enabledAiProviders(envWith({ AI_PROVIDER: "anthropic" })).map(
        (p) => p.id,
      ),
    ).toEqual(["anthropic"]);
  });

  it("AI_MODEL は AI_PROVIDER 側の候補の先頭に入る（他プロバイダには影響しない）", () => {
    const env = envWith({
      AI_PROVIDER: "google",
      AI_MODEL: "gemini-2.0-flash",
      GOOGLE_GENERATIVE_AI_API_KEY: "g-key",
      ANTHROPIC_API_KEY: "a-key",
    });
    const [google, anthropic] = enabledAiProviders(env);
    expect(google?.models).toEqual([
      "gemini-2.0-flash",
      "gemini-2.5-flash",
      "gemini-2.5-pro",
    ]);
    expect(anthropic?.models).toEqual([
      "claude-sonnet-4-5",
      "claude-haiku-4-5",
    ]);
  });

  it("AI_MODEL が既知モデルと同じなら重複させない", () => {
    const env = envWith({ AI_MODEL: "gemini-2.5-pro" });
    expect(enabledAiProviders(env)[0]?.models).toEqual([
      "gemini-2.5-pro",
      "gemini-2.5-flash",
    ]);
  });
});

describe("resolveAiSettings（ユーザー設定 → env 既定の順）", () => {
  const bothKeys = {
    GOOGLE_GENERATIVE_AI_API_KEY: "g-key",
    ANTHROPIC_API_KEY: "a-key",
  } as const;

  it("ユーザー設定が無ければ AI_PROVIDER と候補の先頭（= AI_MODEL があればそれ）", () => {
    const env = envWith({ ...bothKeys, AI_MODEL: "gemini-2.0-flash" });
    const settings = resolveAiSettings(
      { aiProvider: null, aiModel: null },
      env,
    );
    expect(settings.provider).toBe("google");
    expect(settings.model).toBe("gemini-2.0-flash");
    expect(settings.providers).toEqual(enabledAiProviders(env));
  });

  it("AI_MODEL が未設定なら既知モデルの先頭", () => {
    const settings = resolveAiSettings(
      { aiProvider: null, aiModel: null },
      envWith(bothKeys),
    );
    expect(settings.model).toBe("gemini-2.5-flash");
  });

  it("ユーザー設定のプロバイダが有効なら、その provider / model を実効値にする", () => {
    const settings = resolveAiSettings(
      { aiProvider: "anthropic", aiModel: "claude-haiku-4-5" },
      envWith(bothKeys),
    );
    expect(settings.provider).toBe("anthropic");
    expect(settings.model).toBe("claude-haiku-4-5");
  });

  it("候補に無いモデルでもユーザー設定をそのまま使う（モデルは非空文字列なら許可）", () => {
    const settings = resolveAiSettings(
      { aiProvider: "google", aiModel: "gemini-1.5-pro" },
      envWith(bothKeys),
    );
    expect(settings.model).toBe("gemini-1.5-pro");
  });

  it("プロバイダだけ保存されモデルが無ければ、そのプロバイダの候補の先頭", () => {
    const settings = resolveAiSettings(
      { aiProvider: "anthropic", aiModel: null },
      envWith(bothKeys),
    );
    expect(settings.provider).toBe("anthropic");
    expect(settings.model).toBe("claude-sonnet-4-5");
  });

  it("保存済みプロバイダが無効化されていれば env 既定に倒す", () => {
    const settings = resolveAiSettings(
      { aiProvider: "anthropic", aiModel: "claude-haiku-4-5" },
      envWith({ GOOGLE_GENERATIVE_AI_API_KEY: "g-key" }),
    );
    expect(settings.provider).toBe("google");
    expect(settings.model).toBe("gemini-2.5-flash");
    expect(settings.providers.map((p) => p.id)).toEqual(["google"]);
  });

  it("AI_PROVIDER 自体が無効化されていても、有効な先頭のプロバイダに倒す", () => {
    const settings = resolveAiSettings(
      { aiProvider: null, aiModel: null },
      envWith({ AI_PROVIDER: "google", ANTHROPIC_API_KEY: "a-key" }),
    );
    expect(settings.provider).toBe("anthropic");
    expect(settings.model).toBe("claude-sonnet-4-5");
  });

  it("DB に想定外の文字列が入っていても例外にせず既定に倒す", () => {
    const settings = resolveAiSettings(
      { aiProvider: "openai", aiModel: "gpt-4o" },
      envWith(bothKeys),
    );
    expect(settings.provider).toBe("google");
  });
});

describe("AI_GATEWAY_API_KEY（Vercel AI Gateway。#179）", () => {
  it("gateway キーだけでも全プロバイダが有効になる（固有キーを配らずに動かす）", () => {
    const providers = enabledAiProviders(
      envWith({ AI_GATEWAY_API_KEY: "vck_gateway" }),
    );
    expect(providers.map((p) => p.id)).toEqual(["google", "anthropic"]);
  });

  it("gateway キーがあれば ANTHROPIC_API_KEY 無しでも anthropic を実効値にできる", () => {
    const settings = resolveAiSettings(
      { aiProvider: "anthropic", aiModel: null },
      envWith({ AI_GATEWAY_API_KEY: "vck_gateway" }),
    );
    expect(settings.provider).toBe("anthropic");
    expect(settings.model).toBe("claude-sonnet-4-5");
  });

  it("固有キーと併用してもプロバイダ一覧は変わらない（gateway は有効化の別経路）", () => {
    const providers = enabledAiProviders(
      envWith({
        GOOGLE_GENERATIVE_AI_API_KEY: "g",
        AI_GATEWAY_API_KEY: "vck_gateway",
      }),
    );
    expect(providers.map((p) => p.id)).toEqual(["google", "anthropic"]);
  });

  it("どのキーも無ければ従来どおり AI_PROVIDER だけが選択肢", () => {
    const providers = enabledAiProviders(envWith({ AI_PROVIDER: "anthropic" }));
    expect(providers.map((p) => p.id)).toEqual(["anthropic"]);
  });
});
