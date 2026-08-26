import { type Db, schema } from "@dopamin/db";
import { aiSettingsResponseSchema, meResponseSchema } from "@dopamin/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../../src/index";
import { setDbForTesting } from "../../src/lib/db";
import { resetApiEnvCacheForTesting } from "../../src/lib/env";
import { createTestDb } from "../helpers/db";
import { createTestSession } from "../helpers/session";

/**
 * PATCH /settings/ai の統合テスト（FR-17、requirements §10.1 / §10.3）。
 * 許可 / 拒否 / 未認証 / GET /auth/me への反映を pglite のテスト DB で検証する。
 */

const MANAGED_KEYS = [
  "AI_PROVIDER",
  "AI_MODEL",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "ANTHROPIC_API_KEY",
] as const;

function setApiEnv(
  vars: Partial<Record<(typeof MANAGED_KEYS)[number], string>>,
) {
  for (const key of MANAGED_KEYS) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
  resetApiEnvCacheForTesting();
}

let db: Db;
let close: (() => Promise<void>) | undefined;

beforeAll(async () => {
  process.env.DATABASE_URL = "postgres://unused:unused@localhost:1/unused";
  process.env.WEBAUTHN_RP_ID = "localhost";
  process.env.WEBAUTHN_ORIGIN = "http://localhost:3000";
  process.env.REGISTRY_MODE = "mock";
  const testDb = await createTestDb();
  db = testDb.db;
  close = testDb.close;
  setDbForTesting(db);
}, 30_000);

afterAll(async () => {
  setDbForTesting(null);
  // beforeAll が timeout した場合は未代入。ここで TypeError を出すと本来の原因を隠すので省略可能にする
  await close?.();
  setApiEnv({});
});

beforeEach(() => {
  // 既定: google / anthropic の両方が有効
  setApiEnv({
    GOOGLE_GENERATIVE_AI_API_KEY: "g-key",
    ANTHROPIC_API_KEY: "a-key",
  });
});

async function patchAi(body: unknown, cookie?: string): Promise<Response> {
  return await app.request("/api/v1/settings/ai", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: JSON.stringify(body),
  });
}

async function storedAi(userId: string) {
  const rows = await db
    .select({
      aiProvider: schema.users.aiProvider,
      aiModel: schema.users.aiModel,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return rows[0];
}

describe("PATCH /settings/ai", () => {
  it("セッション Cookie が無ければ 401 UNAUTHORIZED", async () => {
    const res = await patchAi({ provider: "google", model: "gemini-2.5-pro" });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

  it("有効なプロバイダなら保存し、更新後の実効値を返す", async () => {
    const { user, cookie } = await createTestSession(db);

    const res = await patchAi(
      { provider: "anthropic", model: "claude-haiku-4-5" },
      cookie,
    );
    expect(res.status).toBe(200);
    const body = aiSettingsResponseSchema.parse(await res.json());
    expect(body.provider).toBe("anthropic");
    expect(body.model).toBe("claude-haiku-4-5");
    expect(body.providers.map((p) => p.id)).toEqual(["google", "anthropic"]);

    expect(await storedAi(user.id)).toEqual({
      aiProvider: "anthropic",
      aiModel: "claude-haiku-4-5",
    });
  });

  it("保存した値が GET /auth/me の ai に反映される（AC: 切替後の実効値）", async () => {
    const { cookie } = await createTestSession(db);
    await patchAi({ provider: "google", model: "gemini-2.5-pro" }, cookie);

    const me = meResponseSchema.parse(
      await (
        await app.request("/api/v1/auth/me", { headers: { cookie } })
      ).json(),
    );
    expect(me.ai.provider).toBe("google");
    expect(me.ai.model).toBe("gemini-2.5-pro");
  });

  it("候補に無いモデルでも非空文字列なら受け付ける", async () => {
    const { cookie } = await createTestSession(db);
    const res = await patchAi(
      { provider: "google", model: "gemini-1.5-pro" },
      cookie,
    );
    expect(res.status).toBe(200);
    expect(aiSettingsResponseSchema.parse(await res.json()).model).toBe(
      "gemini-1.5-pro",
    );
  });

  it("有効化されていないプロバイダは 400 VALIDATION_ERROR で、DB を変えない", async () => {
    setApiEnv({ GOOGLE_GENERATIVE_AI_API_KEY: "g-key" });
    const { user, cookie } = await createTestSession(db);

    const res = await patchAi(
      { provider: "anthropic", model: "claude-haiku-4-5" },
      cookie,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: { provider: "anthropic", enabledProviders: ["google"] },
      },
    });
    expect(await storedAi(user.id)).toEqual({
      aiProvider: null,
      aiModel: null,
    });
  });

  it("モデルが空文字なら 400 VALIDATION_ERROR（zod）", async () => {
    const { cookie } = await createTestSession(db);
    const res = await patchAi({ provider: "google", model: "   " }, cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("provider が google / anthropic 以外なら 400 VALIDATION_ERROR（zod）", async () => {
    const { cookie } = await createTestSession(db);
    const res = await patchAi({ provider: "openai", model: "gpt-4o" }, cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });
});
