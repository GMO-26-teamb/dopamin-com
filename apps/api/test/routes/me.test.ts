import type { Db } from "@dopamin/db";
import { meResponseSchema } from "@dopamin/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../../src/index";
import { setDbForTesting } from "../../src/lib/db";
import { resetApiEnvCacheForTesting } from "../../src/lib/env";
import { createTestDb } from "../helpers/db";
import { createTestSession } from "../helpers/session";

/**
 * GET /auth/me の統合テスト（FR-01 / FR-16 AC-16-1 / FR-17、requirements §10.1）。
 * pglite のテスト DB を注入し、requireSession → users 行の取得 → AI 設定の導出を本番と同じ経路で通す。
 */

const MANAGED_KEYS = [
  "AI_PROVIDER",
  "AI_MODEL",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "ANTHROPIC_API_KEY",
  "DEMO_RESET_ENABLED",
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
let close: () => Promise<void>;

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
  await close();
  setApiEnv({});
});

beforeEach(() => {
  setApiEnv({});
});

async function getMe(cookie?: string): Promise<Response> {
  return await app.request("/api/v1/auth/me", {
    headers: cookie === undefined ? {} : { cookie },
  });
}

describe("GET /auth/me", () => {
  it("セッション Cookie が無ければ 401 UNAUTHORIZED（AC-01-3）", async () => {
    const res = await getMe();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

  it("meResponseSchema の形で user / features / ai を返す", async () => {
    setApiEnv({
      GOOGLE_GENERATIVE_AI_API_KEY: "g-key",
      DEMO_RESET_ENABLED: "true",
    });
    const { user, cookie } = await createTestSession(db, {
      displayName: "たくたく",
    });

    const res = await getMe(cookie);
    expect(res.status).toBe(200);
    const body = meResponseSchema.parse(await res.json());
    expect(body.user).toEqual({ id: user.id, displayName: "たくたく" });
    expect(body.features.demoReset).toBe(true);
    expect(body.ai).toEqual({
      provider: "google",
      model: "gemini-2.5-flash",
      providers: [
        { id: "google", models: ["gemini-2.5-flash", "gemini-2.5-pro"] },
      ],
    });
  });

  it("DEMO_RESET_ENABLED が未設定なら features.demoReset は false（AC-16-1）", async () => {
    const { cookie } = await createTestSession(db);
    const body = meResponseSchema.parse(await (await getMe(cookie)).json());
    expect(body.features.demoReset).toBe(false);
  });

  it("users.ai_provider / ai_model が有効なら実効値に使う（FR-17）", async () => {
    setApiEnv({
      GOOGLE_GENERATIVE_AI_API_KEY: "g-key",
      ANTHROPIC_API_KEY: "a-key",
    });
    const { cookie } = await createTestSession(db, {
      aiProvider: "anthropic",
      aiModel: "claude-haiku-4-5",
    });

    const body = meResponseSchema.parse(await (await getMe(cookie)).json());
    expect(body.ai.provider).toBe("anthropic");
    expect(body.ai.model).toBe("claude-haiku-4-5");
    expect(body.ai.providers.map((p) => p.id)).toEqual(["google", "anthropic"]);
  });

  it("保存済みプロバイダが無効化されていれば env 既定に倒す", async () => {
    setApiEnv({ GOOGLE_GENERATIVE_AI_API_KEY: "g-key" });
    const { cookie } = await createTestSession(db, {
      aiProvider: "anthropic",
      aiModel: "claude-haiku-4-5",
    });

    const body = meResponseSchema.parse(await (await getMe(cookie)).json());
    expect(body.ai.provider).toBe("google");
    expect(body.ai.model).toBe("gemini-2.5-flash");
  });

  it("API キーの値をレスポンスに含めない（NFR-03）", async () => {
    setApiEnv({ GOOGLE_GENERATIVE_AI_API_KEY: "super-secret-google-key" });
    const { cookie } = await createTestSession(db);
    const text = await (await getMe(cookie)).text();
    expect(text).not.toContain("super-secret-google-key");
  });
});
