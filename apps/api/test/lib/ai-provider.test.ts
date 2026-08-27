import { type Db, schema } from "@dopamin/db";
import type { LanguageModel } from "ai";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { z } from "zod";
import {
  type AiAttempt,
  type AiModelFactory,
  resolveAiAttempt,
  resolveModel,
  runStructured,
  setAiModelFactoryForTesting,
} from "../../src/lib/ai-provider";
import { setDbForTesting } from "../../src/lib/db";
import {
  type ApiEnv,
  getApiEnv,
  resetApiEnvCacheForTesting,
} from "../../src/lib/env";
import { ApiException } from "../../src/lib/errors";
import { resolveAiSettings } from "../../src/services/settings";
import { createTestDb, resetTestDb } from "../helpers/db";

/**
 * lib/ai-provider.ts（docs/requirements.md §13.1 / §13.4 / FR-14）。
 * プロバイダは setAiModelFactoryForTesting で差し替え、実際の API は呼ばない。
 * ai_logs への書き込みは pglite の実 DB で検証する（列の制約は test/db/ai-logs-schema.test.ts）。
 */

// このテストが読む環境変数だけをテスト間で確実にリセットする（services/settings.test.ts と同じ流儀）
const AI_KEYS = [
  "AI_PROVIDER",
  "AI_MODEL",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "ANTHROPIC_API_KEY",
  "AI_GATEWAY_API_KEY",
] as const;

type AiKey = (typeof AI_KEYS)[number];

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

/** 両プロバイダ有効（フォールバックが成立する構成）。 */
function envWithBothKeys(): ApiEnv {
  return envWith({
    GOOGLE_GENERATIVE_AI_API_KEY: "g-key",
    ANTHROPIC_API_KEY: "a-key",
  });
}

const CANDIDATES = z.object({
  names: z.array(z.string()).min(1),
});

/** 渡した値を構造化出力として返すモデル。`usage` に null を渡すとトークン数を返さないプロバイダを模す。 */
function respondingModel(
  value: unknown,
  usage: { in: number; out: number } | null = { in: 320, out: 128 },
): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(value) }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: {
        inputTokens: {
          total: usage?.in,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: usage?.out,
          text: undefined,
          reasoning: undefined,
        },
        totalTokens: usage === null ? undefined : usage.in + usage.out,
      },
      warnings: [],
    }),
  });
}

/** 呼ぶと必ず失敗するモデル。`delayMs` を渡すとその時間だけ待ってから失敗する。 */
function failingModel(error: unknown, delayMs?: number): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      if (delayMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      throw error;
    },
  });
}

/** 応答を返さないモデル（タイムアウト検証用）。 */
function hangingModel(): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: () => new Promise<never>(() => {}),
  });
}

function rateLimitError(retryAfter?: string): APICallError {
  return new APICallError({
    message: "rate limit exceeded",
    url: "https://example.invalid/v1/generate",
    requestBodyValues: {},
    statusCode: 429,
    responseHeaders:
      retryAfter === undefined ? {} : { "retry-after": retryAfter },
  });
}

/** モデル生成を差し替え、どの試行が来たかを記録する。 */
function useModels(factory: AiModelFactory) {
  const spy = vi.fn<AiModelFactory>(factory);
  setAiModelFactoryForTesting(spy);
  return spy;
}

/** 呼び出し側が設定を持っている経路（users を引かせない）。 */
function defaultSettings(env: ApiEnv) {
  return resolveAiSettings({ aiProvider: null, aiModel: null }, env);
}

let db: Db;
let closeDb: (() => Promise<void>) | undefined;
let userId: string;

beforeAll(async () => {
  const created = await createTestDb();
  db = created.db;
  closeDb = created.close;
  setDbForTesting(db);
}, 30_000);

afterAll(async () => {
  setDbForTesting(null);
  await closeDb?.();
  for (const key of AI_KEYS) {
    delete process.env[key];
  }
  resetApiEnvCacheForTesting();
});

beforeEach(async () => {
  envWith({});
  await resetTestDb(db);
  const rows = await db
    .insert(schema.users)
    .values({ displayName: "AI テスト" })
    .returning({ id: schema.users.id });
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("users の INSERT に失敗した");
  userId = id;
});

afterEach(() => {
  setAiModelFactoryForTesting(null);
  vi.restoreAllMocks();
});

/** 例外を投げさせて捕まえる（型を絞らずに assert したいので then の 2 引数版）。 */
function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

describe("resolveAiAttempt / resolveModel（§13.1 実効設定）", () => {
  it("ユーザー設定が環境変数の既定より優先される", () => {
    envWithBothKeys();
    expect(
      resolveAiAttempt({
        aiProvider: "anthropic",
        aiModel: "claude-haiku-4-5",
      }),
    ).toEqual({ provider: "anthropic", model: "claude-haiku-4-5" });
  });

  it("ユーザー未設定なら AI_PROVIDER / AI_MODEL を使う", () => {
    envWith({
      AI_PROVIDER: "anthropic",
      AI_MODEL: "claude-sonnet-4-5",
      ANTHROPIC_API_KEY: "a-key",
    });
    expect(resolveAiAttempt()).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    });
  });

  it("保存済みプロバイダの API キーが外れていたら既定に倒す", () => {
    envWith({ AI_PROVIDER: "google", GOOGLE_GENERATIVE_AI_API_KEY: "g-key" });
    expect(
      resolveAiAttempt({
        aiProvider: "anthropic",
        aiModel: "claude-haiku-4-5",
      }).provider,
    ).toBe("google");
  });

  it("API キーが 1 つも無い環境では AI_UNAVAILABLE（503）", () => {
    envWith({});
    expect(() => resolveModel()).toThrow(ApiException);
    try {
      resolveModel();
    } catch (error) {
      expect((error as ApiException).code).toBe("AI_UNAVAILABLE");
      expect((error as ApiException).status).toBe(503);
    }
  });
});

/**
 * `LanguageModel` は `string | LanguageModelVx` のユニオンなので、
 * どちらの形でもモデル ID を取り出せるようにする。
 */
function modelIdOf(model: LanguageModel): string {
  return typeof model === "string" ? model : model.modelId;
}

describe("defaultModelFactory の gateway 経路（#179）", () => {
  // このブロックだけは差し替えを外して既定のファクトリを通す
  beforeEach(() => {
    setAiModelFactoryForTesting(null);
  });

  it("固有キーが無くても AI_GATEWAY_API_KEY があれば 503 にならない", () => {
    envWith({ AI_GATEWAY_API_KEY: "vck_gateway" });
    expect(() => resolveModel()).not.toThrow();
  });

  it("gateway 経由のモデル ID は <provider>/<model> になる", () => {
    envWith({
      AI_PROVIDER: "anthropic",
      AI_MODEL: "claude-haiku-4-5",
      AI_GATEWAY_API_KEY: "vck_gateway",
    });
    // anthropic はカタログがドット表記なので読み替えも効く（#187 / §2.7）
    expect(modelIdOf(resolveModel())).toBe("anthropic/claude-haiku-4.5");
  });

  it("AI_MODEL が既にスラッシュ付きなら二重に前置しない", () => {
    envWith({
      AI_PROVIDER: "google",
      AI_MODEL: "google/gemini-2.5-pro",
      AI_GATEWAY_API_KEY: "vck_gateway",
    });
    expect(modelIdOf(resolveModel())).toBe("google/gemini-2.5-pro");
  });

  it("固有キーがあるときは gateway を挟まず従来どおり直接プロバイダを使う", () => {
    envWith({
      AI_PROVIDER: "google",
      AI_MODEL: "gemini-2.5-flash",
      GOOGLE_GENERATIVE_AI_API_KEY: "g-key",
      AI_GATEWAY_API_KEY: "vck_gateway",
    });
    // 直接経路はプロバイダ側の素のモデル ID（gateway の <provider>/ 前置が付かない）
    expect(modelIdOf(resolveModel())).toBe("gemini-2.5-flash");
  });
});

describe("runStructured（§13.1 呼び出し / AC-14-1・AC-14-2 記録）", () => {
  it("構造化出力を返し、ai_logs に success 行を 1 件残す", async () => {
    const env = envWith({ GOOGLE_GENERATIVE_AI_API_KEY: "g-key" });
    useModels(() => respondingModel({ names: ["dopamin.dev"] }));

    const result = await runStructured(
      "domain_candidates",
      CANDIDATES,
      "システムプロンプト全文とユーザー入力を含む長いプロンプト",
      {
        user: { id: userId },
        input: { nickname: "どぱみん" },
        settings: defaultSettings(env),
      },
    );

    expect(result).toEqual({ names: ["dopamin.dev"] });
    const rows = await db.select().from(schema.aiLogs);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId,
      feature: "domain_candidates",
      provider: "google",
      model: "gemini-2.5-flash",
      status: "success",
      tokensIn: 320,
      tokensOut: 128,
      output: { names: ["dopamin.dev"] },
      errorMessage: null,
    });
    expect(rows[0]?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("プロンプト全文は ai_logs に保存されず、input の要約だけが残る（AC-14-2）", async () => {
    const env = envWith({ GOOGLE_GENERATIVE_AI_API_KEY: "g-key" });
    useModels(() => respondingModel({ names: ["dopamin.dev"] }));

    await runStructured(
      "uniqueness",
      CANDIDATES,
      "秘密のシステムプロンプト: 絶対にログへ出してはいけない指示",
      {
        user: { id: userId },
        input: { nickname: "どぱみん" },
        settings: defaultSettings(env),
      },
    );

    const rows = await db.select().from(schema.aiLogs);
    expect(rows[0]?.inputSummary).toBe('{"nickname":"どぱみん"}');
    expect(JSON.stringify(rows[0])).not.toContain("秘密のシステムプロンプト");
  });

  it("本命が失敗したら別プロバイダへ 1 回だけ切り替え、両方の試行を記録する", async () => {
    const env = envWithBothKeys();
    const factory = useModels((attempt) =>
      attempt.provider === "google"
        ? failingModel(new Error("google down"))
        : respondingModel({ names: ["dopamin.dev"] }),
    );

    const result = await runStructured("subdomain_plan", CANDIDATES, "prompt", {
      user: { id: userId },
      input: "dopamin.dev",
      settings: defaultSettings(env),
    });

    expect(result).toEqual({ names: ["dopamin.dev"] });
    expect(
      factory.mock.calls.map(([attempt]: [AiAttempt]) => attempt.provider),
    ).toEqual(["google", "anthropic"]);

    const rows = await db.select().from(schema.aiLogs);
    expect(rows).toHaveLength(2);
    const google = rows.find((row) => row.provider === "google");
    const anthropic = rows.find((row) => row.provider === "anthropic");
    expect(google?.status).toBe("error");
    expect(google?.errorMessage).toBe("google down");
    // 実際に応答した側のプロバイダ・モデルが success 行に残る（§9.1）
    expect(anthropic).toMatchObject({
      status: "success",
      model: "claude-sonnet-4-5",
    });
  });

  it("フォールバック先も失敗したら 3 回目は無く AI_UNAVAILABLE（503）", async () => {
    const env = envWithBothKeys();
    const factory = useModels(() => failingModel(new Error("both down")));

    const error = await rejection(
      runStructured("uniqueness", CANDIDATES, "prompt", {
        user: { id: userId },
        input: "dopamin.dev",
        settings: defaultSettings(env),
      }),
    );

    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).code).toBe("AI_UNAVAILABLE");
    expect((error as ApiException).status).toBe(503);
    expect((error as ApiException).retryable).toBe(true);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(await db.$count(schema.aiLogs)).toBe(2);
  });

  it("片方のプロバイダしか有効でなければフォールバックしない", async () => {
    const env = envWith({ GOOGLE_GENERATIVE_AI_API_KEY: "g-key" });
    const factory = useModels(() => failingModel(new Error("google down")));

    await expect(
      runStructured("uniqueness", CANDIDATES, "prompt", {
        user: { id: userId },
        input: "dopamin.dev",
        settings: defaultSettings(env),
      }),
    ).rejects.toBeInstanceOf(ApiException);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(await db.$count(schema.aiLogs)).toBe(1);
  });

  it("スキーマに合わない出力は AI_UNAVAILABLE になり error 行が残る（出力を信用しない）", async () => {
    const env = envWith({ GOOGLE_GENERATIVE_AI_API_KEY: "g-key" });
    useModels(() => respondingModel({ names: [] }));

    const error = await rejection(
      runStructured("uniqueness", CANDIDATES, "prompt", {
        user: { id: userId },
        input: "dopamin.dev",
        settings: defaultSettings(env),
      }),
    );

    expect((error as ApiException).code).toBe("AI_UNAVAILABLE");
    const rows = await db.select().from(schema.aiLogs);
    expect(rows[0]?.status).toBe("error");
    expect(rows[0]?.output).toBeNull();
  });

  it("プロバイダの 429 は RATE_LIMITED（429）に変換し、Retry-After を details に載せる", async () => {
    const env = envWith({ GOOGLE_GENERATIVE_AI_API_KEY: "g-key" });
    useModels(() => failingModel(rateLimitError("30")));

    const error = await rejection(
      runStructured("uniqueness", CANDIDATES, "prompt", {
        user: { id: userId },
        input: "dopamin.dev",
        settings: defaultSettings(env),
      }),
    );

    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).code).toBe("RATE_LIMITED");
    expect((error as ApiException).status).toBe(429);
    expect((error as ApiException).details).toEqual({ retryAfter: 30 });
    const rows = await db.select().from(schema.aiLogs);
    expect(rows[0]?.errorMessage).toContain("HTTP 429");
  });

  it("Retry-After が無ければ details は付けない（web が読むのは正の秒数のみ）", async () => {
    const env = envWith({ GOOGLE_GENERATIVE_AI_API_KEY: "g-key" });
    useModels(() => failingModel(rateLimitError()));

    const error = await rejection(
      runStructured("uniqueness", CANDIDATES, "prompt", {
        user: { id: userId },
        input: "dopamin.dev",
        settings: defaultSettings(env),
      }),
    );

    expect((error as ApiException).code).toBe("RATE_LIMITED");
    expect((error as ApiException).details).toBeUndefined();
  });

  it("プロバイダがトークン数を返さなければ tokens は NULL のまま記録する", async () => {
    const env = envWith({ GOOGLE_GENERATIVE_AI_API_KEY: "g-key" });
    useModels(() => respondingModel({ names: ["dopamin.dev"] }, null));

    await runStructured("uniqueness", CANDIDATES, "prompt", {
      user: { id: userId },
      input: "dopamin.dev",
      settings: defaultSettings(env),
    });

    const rows = await db.select().from(schema.aiLogs);
    expect(rows[0]?.tokensIn).toBeNull();
    expect(rows[0]?.tokensOut).toBeNull();
  });

  it("プロバイダの生エラー文言はクライアントに返さない（NFR-03）", async () => {
    const env = envWith({ GOOGLE_GENERATIVE_AI_API_KEY: "g-key" });
    useModels(() => failingModel(new Error("api key sk-secret is invalid")));

    const error = await rejection(
      runStructured("uniqueness", CANDIDATES, "prompt", {
        user: { id: userId },
        input: "dopamin.dev",
        settings: defaultSettings(env),
      }),
    );

    expect((error as ApiException).message).not.toContain("sk-secret");
    // 生の文言は ai_logs 側にだけ残す
    const rows = await db.select().from(schema.aiLogs);
    expect(rows[0]?.errorMessage).toContain("sk-secret");
  });

  it("settings 未指定なら users 行から実効設定を引く（FR-17 の保存値を使う）", async () => {
    envWithBothKeys();
    await db
      .update(schema.users)
      .set({ aiProvider: "anthropic", aiModel: "claude-haiku-4-5" });
    const factory = useModels(() => respondingModel({ names: ["a.dev"] }));

    await runStructured("uniqueness", CANDIDATES, "prompt", {
      user: { id: userId },
      input: "a.dev",
    });

    expect(factory).toHaveBeenCalledWith({
      provider: "anthropic",
      model: "claude-haiku-4-5",
    });
  });

  it("ai_logs の書き込みに失敗しても AI 呼び出しは成功する（記録は握りつぶす）", async () => {
    const env = envWith({ GOOGLE_GENERATIVE_AI_API_KEY: "g-key" });
    useModels(() => respondingModel({ names: ["dopamin.dev"] }));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const brokenDb = {
      insert: () => ({
        values: () => Promise.reject(new Error("connection refused")),
      }),
    } as unknown as Db;

    const result = await runStructured("uniqueness", CANDIDATES, "prompt", {
      user: { id: userId },
      input: "dopamin.dev",
      settings: defaultSettings(env),
      db: brokenDb,
    });

    expect(result).toEqual({ names: ["dopamin.dev"] });
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("ai_log_write_failed"),
    );
  });
});

describe("runStructured のタイムアウト（§13.1 20 秒）", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("上限時間内に応答が無ければ打ち切り、AI_UNAVAILABLE と error 行になる", async () => {
    const env = envWith({ GOOGLE_GENERATIVE_AI_API_KEY: "g-key" });
    useModels(() => hangingModel());
    // pglite を偽タイマー下で待たせないよう、記録先はスタブにする
    const values = vi.fn().mockResolvedValue(undefined);
    const stubDb = { insert: vi.fn(() => ({ values })) } as unknown as Db;
    vi.useFakeTimers();

    const pending = runStructured("uniqueness", CANDIDATES, "prompt", {
      user: { id: userId },
      input: "dopamin.dev",
      settings: defaultSettings(env),
      db: stubDb,
    });
    const assertion = expect(pending).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        errorMessage: "AI が 20000ms 以内に応答しませんでした",
        latencyMs: 20_000,
      }),
    );
  });

  it("本命が予算を使い切ったらフォールバックしない（合計 20 秒を守る）", async () => {
    const env = envWithBothKeys();
    const factory = useModels(() => hangingModel());
    const values = vi.fn().mockResolvedValue(undefined);
    const stubDb = { insert: vi.fn(() => ({ values })) } as unknown as Db;
    vi.useFakeTimers();

    const pending = runStructured("uniqueness", CANDIDATES, "prompt", {
      user: { id: userId },
      input: "dopamin.dev",
      settings: defaultSettings(env),
      db: stubDb,
    });
    const assertion = expect(pending).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;

    // 両プロバイダ有効でも 2 回目は始めない（始めても即打ち切りになるだけ）
    expect(factory).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledTimes(1);
  });

  it("ai_logs の書き込みの遅さは予算から差し引かない（DB が遅いだけでフォールバックを消さない）", async () => {
    const env = envWithBothKeys();
    const factory = useModels((attempt) =>
      attempt.provider === "google"
        ? failingModel(new Error("google down"), 16_200)
        : respondingModel({ names: ["dopamin.dev"] }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    // INSERT が返らず、記録が上限（AI_LOG_WRITE_TIMEOUT_MS = 3 秒）まで待たされる DB
    const stuckDb = {
      insert: () => ({ values: () => new Promise<never>(() => {}) }),
    } as unknown as Db;
    vi.useFakeTimers();

    const pending = runStructured("uniqueness", CANDIDATES, "prompt", {
      user: { id: userId },
      input: "dopamin.dev",
      settings: defaultSettings(env),
      db: stuckDb,
    });
    // google 失敗まで 16.2 秒 + 記録待ち 3 秒 = 19.2 秒。予算に記録待ちを含めると
    // 残り 0.8 秒となってフォールバックが打ち切られてしまう
    await vi.advanceTimersByTimeAsync(40_000);

    await expect(pending).resolves.toEqual({ names: ["dopamin.dev"] });
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

describe("Gateway の ID 変換表（#187）", () => {
  beforeEach(() => {
    setAiModelFactoryForTesting(null);
  });

  it("xai は Gateway 上の接頭辞 spacexai に読み替える", () => {
    envWith({
      AI_PROVIDER: "google",
      AI_GATEWAY_API_KEY: "vck_gateway",
    });
    expect(
      modelIdOf(
        resolveModel({
          aiProvider: "xai",
          aiModel: "grok-4.1-fast-non-reasoning",
        }),
      ),
    ).toBe("spacexai/grok-4.1-fast-non-reasoning");
  });

  it("gateway 経由の anthropic はドット表記に読み替える（カタログに合わせる）", () => {
    envWith({
      AI_PROVIDER: "google",
      AI_GATEWAY_API_KEY: "vck_gateway",
    });
    expect(
      modelIdOf(
        resolveModel({ aiProvider: "anthropic", aiModel: "claude-sonnet-4-5" }),
      ),
    ).toBe("anthropic/claude-sonnet-4.5");
  });

  it("固有キーで直叩きする anthropic はハイフンのまま（Anthropic API の ID）", () => {
    envWith({
      AI_PROVIDER: "anthropic",
      AI_MODEL: "claude-sonnet-4-5",
      ANTHROPIC_API_KEY: "a-key",
      AI_GATEWAY_API_KEY: "vck_gateway",
    });
    expect(modelIdOf(resolveModel())).toBe("claude-sonnet-4-5");
  });

  it("読み替え表に無いモデルはそのまま前置するだけ", () => {
    envWith({
      AI_PROVIDER: "google",
      AI_MODEL: "gemini-2.5-pro",
      AI_GATEWAY_API_KEY: "vck_gateway",
    });
    expect(modelIdOf(resolveModel())).toBe("google/gemini-2.5-pro");
  });
});

describe("3 プロバイダでのフォールバック（#187 / §13.1）", () => {
  it("プロバイダが 3 つでも試行は最大 2 回で、本命以外の先頭が候補になる", () => {
    const env = envWith({ AI_GATEWAY_API_KEY: "vck_gateway" });
    const settings = resolveAiSettings(
      { aiProvider: "google", aiModel: null },
      env,
    );
    // AI_PROVIDERS の順（google → anthropic → xai）がフォールバック先の優先順
    expect(settings.providers.map((p) => p.id)).toEqual([
      "google",
      "anthropic",
      "xai",
    ]);
  });
});
