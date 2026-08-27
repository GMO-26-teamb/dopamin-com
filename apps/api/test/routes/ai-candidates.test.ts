import { type Db, schema } from "@dopamin/db";
import type { DomainCandidatesResponse } from "@dopamin/shared";
import type { LanguageModel } from "ai";
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
import app from "../../src/index";
import { setAiModelFactoryForTesting } from "../../src/lib/ai-provider";
import { setDbForTesting } from "../../src/lib/db";
import { resetApiEnvCacheForTesting } from "../../src/lib/env";
import { setRegistrySetForTesting } from "../../src/lib/registries";
import { setRetrySleepForTesting } from "../../src/lib/retry";
import { createTestDb, resetTestDb } from "../helpers/db";
import { createTestSession } from "../helpers/session";

/**
 * POST /ai/domain-candidates（docs/requirements.md FR-04 / §10.1）の統合テスト。
 * AI は setAiModelFactoryForTesting で差し替え、レジストリは mock を環境変数から配線する。
 */

let db: Db;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
  setDbForTesting(db);
}, 30_000);

afterAll(async () => {
  setDbForTesting(null);
  await closeDb();
});

beforeEach(async () => {
  // 参照系の自動再試行（#60）のバックオフを実時間で待たない。
  // MOCK_REGISTRY_FAIL_MODE を使うテストが 300ms + 600ms を毎回待つと、
  // 候補 6 件のスコア算出と合わせて既定のテストタイムアウトに届いてしまう
  setRetrySleepForTesting(() => Promise.resolve());
  await resetTestDb(db);
  setDbForTesting(db);
  process.env.REGISTRY_MODE = "mock";
  delete process.env.MOCK_REGISTRY_FAIL_MODE;
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "g-key";
  delete process.env.ANTHROPIC_API_KEY;
  process.env.AI_MODEL = "gemini-2.5-flash";
  resetApiEnvCacheForTesting();
  setRegistrySetForTesting(null);
  // 構造化ログでテスト出力を汚さない
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  setRetrySleepForTesting(null);
  setAiModelFactoryForTesting(null);
  setRegistrySetForTesting(null);
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.AI_MODEL;
  resetApiEnvCacheForTesting();
  vi.restoreAllMocks();
});

interface RawCandidate {
  sld: string;
  tld: string;
  reason: string;
}

/** 呼ばれた回数ぶん、順に用意した候補リストを返すモデル。 */
function candidatesModel(...rounds: RawCandidate[][]): LanguageModel {
  let call = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const candidates = rounds[Math.min(call, rounds.length - 1)] ?? [];
      call += 1;
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ candidates }) },
        ],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: {
          inputTokens: {
            total: 200,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 80, text: undefined, reasoning: undefined },
          totalTokens: 280,
        },
        warnings: [],
      };
    },
  });
}

function sixCandidates(prefix = "taku"): RawCandidate[] {
  return Array.from({ length: 6 }, (_, i) => ({
    sld: `${prefix}${i}`,
    tld: "com",
    reason: `${i} 番目の理由`,
  }));
}

async function post(
  body: unknown,
  cookie: string,
): Promise<{ status: number; json: unknown }> {
  const res = await app.request("/api/v1/ai/domain-candidates", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

describe("POST /ai/domain-candidates（FR-04）", () => {
  it("候補 6 件に空き確認と独自性スコアが付く（AC-04-1）", async () => {
    const { cookie } = await createTestSession(db);
    setAiModelFactoryForTesting(() => candidatesModel(sixCandidates()));

    const { status, json } = await post({ nickname: "たくたく" }, cookie);
    const body = json as DomainCandidatesResponse;

    expect(status).toBe(200);
    expect(body.candidates).toHaveLength(6);
    const first = body.candidates[0];
    expect(first?.sld).toBe("taku0");
    expect(first?.tld).toBe("com");
    expect(first?.check.name).toBe("taku0.com");
    expect(first?.check.availability).toBe("available");
    // FR-05: 空きの候補には独自性スコアが付く
    expect(first?.check.uniqueness?.score).toBeGreaterThanOrEqual(0);
    expect(first?.check.uniqueness?.label).toBeDefined();
  });

  it("AI 呼び出しが ai_logs に記録される（AC-04-3）", async () => {
    const { user, cookie } = await createTestSession(db);
    setAiModelFactoryForTesting(() => candidatesModel(sixCandidates()));

    await post({ nickname: "たくたく", purpose: "個人サイト" }, cookie);

    const rows = await db.select().from(schema.aiLogs);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: user.id,
      feature: "domain_candidates",
      provider: "google",
      model: "gemini-2.5-flash",
      status: "success",
    });
    // AC-14-2: プロンプト全文ではなく意味的な入力の要約
    expect(rows[0]?.inputSummary).toContain("たくたく");
  });

  it("重複・不正 SLD・許可外 TLD を弾き、不足分を 1 回だけ再生成する", async () => {
    const { cookie } = await createTestSession(db);
    const model = candidatesModel(
      [
        { sld: "ok1", tld: "com", reason: "良い" },
        // 同じ SLD の重複
        { sld: "ok1", tld: "net", reason: "重複" },
        // RFC 1035 違反（先頭ハイフン）
        { sld: "-bad", tld: "com", reason: "不正" },
        // 許可リスト外の TLD
        { sld: "ok2", tld: "jp", reason: "対象外" },
      ],
      [
        { sld: "ok3", tld: "com", reason: "2 巡目 1" },
        { sld: "ok4", tld: "net", reason: "2 巡目 2" },
        { sld: "ok5", tld: "org", reason: "2 巡目 3" },
        { sld: "ok6", tld: "info", reason: "2 巡目 4" },
        { sld: "ok7", tld: "com", reason: "2 巡目 5" },
      ],
    );
    const factory = vi.fn(() => model);
    setAiModelFactoryForTesting(factory);

    const { status, json } = await post({ nickname: "たくたく" }, cookie);
    const body = json as DomainCandidatesResponse;

    expect(status).toBe(200);
    // 再生成は 1 回だけ（合計 2 回の呼び出し）
    expect(factory).toHaveBeenCalledTimes(2);
    expect(body.candidates).toHaveLength(6);
    const names = body.candidates.map((c) => `${c.sld}.${c.tld}`);
    expect(names).toEqual([
      "ok1.com",
      "ok3.com",
      "ok4.net",
      "ok5.org",
      "ok6.info",
      "ok7.com",
    ]);
    // ai_logs には試行ごとに 1 行残る
    expect(await db.$count(schema.aiLogs)).toBe(2);
  });

  it("6 件揃えば再生成しない", async () => {
    const { cookie } = await createTestSession(db);
    const factory = vi.fn(() => candidatesModel(sixCandidates()));
    setAiModelFactoryForTesting(factory);

    await post({ nickname: "たくたく" }, cookie);

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("exclude に挙げた名前は SLD 単位で除外される", async () => {
    const { cookie } = await createTestSession(db);
    setAiModelFactoryForTesting(() =>
      candidatesModel([
        { sld: "taku0", tld: "com", reason: "除外対象" },
        { sld: "keep", tld: "com", reason: "残る" },
      ]),
    );

    const { json } = await post(
      // FQDN でも SLD でも同じ SLD として弾ける
      { nickname: "たくたく", exclude: ["taku0.net"] },
      cookie,
    );
    const body = json as DomainCandidatesResponse;

    expect(body.candidates.map((c) => c.sld)).toEqual(["keep"]);
  });

  it("tlds を指定すると許可リストがその範囲に絞られる", async () => {
    const { cookie } = await createTestSession(db);
    setAiModelFactoryForTesting(() =>
      candidatesModel([
        { sld: "a", tld: "com", reason: "許可外" },
        { sld: "b", tld: "dev", reason: "未対応" },
        { sld: "c", tld: "xyz", reason: "許可内" },
      ]),
    );

    const { json } = await post(
      { nickname: "たくたく", tlds: ["xyz"] },
      cookie,
    );
    const body = json as DomainCandidatesResponse;

    expect(body.candidates.map((c) => `${c.sld}.${c.tld}`)).toEqual(["c.xyz"]);
  });

  it("AI が応答しないと AI_UNAVAILABLE（503）で、error 行が残る（AC-04-2）", async () => {
    const { cookie } = await createTestSession(db);
    setAiModelFactoryForTesting(
      () =>
        new MockLanguageModelV4({
          doGenerate: async () => {
            throw new Error("provider down");
          },
        }),
    );

    const { status, json } = await post({ nickname: "たくたく" }, cookie);

    expect(status).toBe(503);
    expect((json as { error: { code: string } }).error.code).toBe(
      "AI_UNAVAILABLE",
    );
    const rows = await db.select().from(schema.aiLogs);
    expect(rows[0]).toMatchObject({
      feature: "domain_candidates",
      status: "error",
    });
  });

  it("レジストリ障害でも候補とスコアは返る（AC-05-2）", async () => {
    const { cookie } = await createTestSession(db);
    process.env.MOCK_REGISTRY_FAIL_MODE = "5xx";
    resetApiEnvCacheForTesting();
    setRegistrySetForTesting(null);
    setAiModelFactoryForTesting(() => candidatesModel(sixCandidates()));

    const { status, json } = await post({ nickname: "たくたく" }, cookie);
    const body = json as DomainCandidatesResponse;

    expect(status).toBe(200);
    expect(body.candidates).toHaveLength(6);
    expect(body.candidates[0]?.check.availability).toBe("error");
    expect(body.candidates[0]?.check.uniqueness).not.toBeNull();
  });

  it("nickname が無ければ VALIDATION_ERROR（400）", async () => {
    const { cookie } = await createTestSession(db);
    const { status, json } = await post({ purpose: "個人サイト" }, cookie);

    expect(status).toBe(400);
    expect((json as { error: { code: string } }).error.code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("未認証は 401", async () => {
    const res = await app.request("/api/v1/ai/domain-candidates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname: "たくたく" }),
    });
    expect(res.status).toBe(401);
  });
});
