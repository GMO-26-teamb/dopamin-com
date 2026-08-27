import { describe, expect, it } from "vitest";
import {
  AI_FEATURES,
  AI_PROVIDERS,
  AI_SUMMARY_MAX_LENGTH,
  aiFeatureSchema,
  aiLogStatusSchema,
  aiProviderSchema,
  aiSettingsSchema,
  aiSettingsUpdateRequestSchema,
  aiTokenTotal,
  demoResetResponseSchema,
  summarizeForAiLog,
} from "./ai";

describe("AI enum", () => {
  it("機能は要件 §9.1 の 3 種", () => {
    expect(AI_FEATURES).toEqual([
      "domain_candidates",
      "uniqueness",
      "subdomain_plan",
    ]);
    for (const feature of AI_FEATURES) {
      expect(aiFeatureSchema.parse(feature)).toBe(feature);
    }
    expect(aiFeatureSchema.safeParse("subdomain").success).toBe(false);
  });

  it("プロバイダは FR-17 の 3 種", () => {
    expect(AI_PROVIDERS).toEqual(["google", "anthropic", "xai"]);
    expect(aiProviderSchema.safeParse("openai").success).toBe(false);
  });

  it("AI ログの結果は success / error のみ", () => {
    expect(aiLogStatusSchema.parse("success")).toBe("success");
    expect(aiLogStatusSchema.parse("error")).toBe("error");
    expect(aiLogStatusSchema.safeParse("timeout").success).toBe(false);
  });
});

describe("aiSettingsSchema", () => {
  const settings = {
    provider: "google",
    model: "gemini-2.5-flash",
    providers: [
      { id: "google", models: ["gemini-2.5-flash", "gemini-2.5-pro"] },
      { id: "anthropic", models: ["claude-sonnet-4-5"] },
    ],
  };

  it("現在値 + 選択肢を受理する（web の AiSettings と同形）", () => {
    expect(aiSettingsSchema.parse(settings)).toEqual(settings);
  });

  it("空のモデル一覧を持つプロバイダは弾く", () => {
    expect(
      aiSettingsSchema.safeParse({
        ...settings,
        providers: [{ id: "google", models: [] }],
      }).success,
    ).toBe(false);
  });

  it("選択肢が 0 件（プロバイダ未設定の環境）は許容する", () => {
    expect(
      aiSettingsSchema.safeParse({ ...settings, providers: [] }).success,
    ).toBe(true);
  });
});

describe("aiSettingsUpdateRequestSchema", () => {
  it("provider と model を必須にする", () => {
    expect(
      aiSettingsUpdateRequestSchema.parse({
        provider: "anthropic",
        model: "claude-sonnet-4-5",
      }),
    ).toEqual({ provider: "anthropic", model: "claude-sonnet-4-5" });
    expect(
      aiSettingsUpdateRequestSchema.safeParse({ provider: "anthropic" })
        .success,
    ).toBe(false);
    expect(
      aiSettingsUpdateRequestSchema.safeParse({
        provider: "anthropic",
        model: "  ",
      }).success,
    ).toBe(false);
  });

  it("API キーなど余分なキーは落とす（クライアントから秘密情報を受け取らない）", () => {
    expect(
      aiSettingsUpdateRequestSchema.parse({
        provider: "google",
        model: "gemini-2.5-flash",
        apiKey: "sk-should-be-ignored",
      }),
    ).toEqual({ provider: "google", model: "gemini-2.5-flash" });
  });
});

describe("demoResetResponseSchema", () => {
  it("投入し直したデモドメインを返す", () => {
    const body = { ok: true, domains: ["dopamin-demo-a1b2.com"] };
    expect(demoResetResponseSchema.parse(body)).toEqual(body);
  });

  it("ok: false は返さない（失敗は §10.3 のエラー形式）", () => {
    expect(
      demoResetResponseSchema.safeParse({ ok: false, domains: [] }).success,
    ).toBe(false);
  });
});

describe("summarizeForAiLog", () => {
  it("文字列は空白を畳んでそのまま返す", () => {
    expect(summarizeForAiLog("  ドパ民\n  の候補  ")).toBe("ドパ民 の候補");
  });

  it("構造化出力は JSON 化して要約する", () => {
    expect(summarizeForAiLog({ candidates: ["a", "b"] })).toBe(
      '{"candidates":["a","b"]}',
    );
  });

  it("上限を超えたら末尾を … にして切り詰める（AC-14-2）", () => {
    const summary = summarizeForAiLog("あ".repeat(500));
    expect(summary).toHaveLength(AI_SUMMARY_MAX_LENGTH);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("maxLength を指定できる", () => {
    expect(summarizeForAiLog("abcdefghij", 5)).toBe("abcd…");
  });

  it("undefined と循環参照でも例外を投げない", () => {
    expect(summarizeForAiLog(undefined)).toBe("");
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => summarizeForAiLog(circular)).not.toThrow();
  });
});

describe("aiTokenTotal", () => {
  it("取得できたものを合計する", () => {
    expect(aiTokenTotal(120, 340)).toBe(460);
    expect(aiTokenTotal(120, null)).toBe(120);
    expect(aiTokenTotal(null, 340)).toBe(340);
  });

  it("どちらも取得できなければ null（画面では非表示）", () => {
    expect(aiTokenTotal(null, null)).toBeNull();
    expect(aiTokenTotal(undefined, undefined)).toBeNull();
  });
});
