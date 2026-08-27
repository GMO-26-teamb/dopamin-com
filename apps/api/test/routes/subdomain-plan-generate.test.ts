import { type Db, schema } from "@dopamin/db";
import type { SubdomainPlanProposalResponse } from "@dopamin/shared";
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
import { createTestDb, resetTestDb } from "../helpers/db";
import { createTestSession } from "../helpers/session";

/**
 * POST /domains/:name/subdomain-plan（docs/requirements.md FR-13 / AC-13-1 / AC-13-2）。
 * GitHub は GITHUB_MODE=mock、AI は setAiModelFactoryForTesting で差し替える。
 */

let db: Db;
let closeDb: () => Promise<void>;

const PROPOSAL = {
  policy: "www を入口にし、API とドキュメントをホスト単位で分ける",
  items: [
    {
      host: "www",
      purpose: "ランディングページ",
      recordType: "CNAME",
      target: "cname.vercel-dns.com",
      priority: "required",
    },
    {
      host: "api",
      purpose: "REST API",
      recordType: "CNAME",
      target: "cname.vercel-dns.com",
      priority: "recommended",
    },
    {
      host: "docs",
      purpose: "仕様書",
      recordType: "CNAME",
      target: "dopamin.github.io",
      priority: "optional",
    },
  ],
};

function proposalModel(value: unknown = PROPOSAL): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(value) }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: {
        inputTokens: {
          total: 500,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 200, text: undefined, reasoning: undefined },
        totalTokens: 700,
      },
      warnings: [],
    }),
  });
}

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
  setDbForTesting(db);
}, 30_000);

afterAll(async () => {
  setDbForTesting(null);
  await closeDb();
});

beforeEach(async () => {
  await resetTestDb(db);
  setDbForTesting(db);
  process.env.REGISTRY_MODE = "mock";
  process.env.GITHUB_MODE = "mock";
  delete process.env.GITHUB_MOCK_FAIL_MODE;
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "g-key";
  delete process.env.ANTHROPIC_API_KEY;
  process.env.AI_MODEL = "gemini-2.5-flash";
  resetApiEnvCacheForTesting();
  setRegistrySetForTesting(null);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  setAiModelFactoryForTesting(null);
  setRegistrySetForTesting(null);
  for (const key of [
    "GITHUB_MODE",
    "GITHUB_MOCK_FAIL_MODE",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "AI_MODEL",
  ]) {
    delete process.env[key];
  }
  resetApiEnvCacheForTesting();
  vi.restoreAllMocks();
});

/** 保有ドメインの行を 1 件作る（requireOwnedDomain を通すため）。 */
async function seedDomain(userId: string, name = "demo.com"): Promise<void> {
  await db.insert(schema.domains).values({
    userId,
    name,
    sld: name.split(".")[0] ?? name,
    tld: name.split(".")[1] ?? "com",
    registry: "mock",
    statuses: ["ok"],
    syncedAt: new Date(),
  });
}

async function post(
  name: string,
  body: unknown,
  cookie: string,
): Promise<{ status: number; json: unknown }> {
  const res = await app.request(`/api/v1/domains/${name}/subdomain-plan`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

describe("POST /domains/:name/subdomain-plan（FR-13）", () => {
  it("リポジトリ URL から提案を返す（保存はしない）", async () => {
    const { user, cookie } = await createTestSession(db);
    await seedDomain(user.id);
    setAiModelFactoryForTesting(() => proposalModel());

    const { status, json } = await post(
      "demo.com",
      { repoUrl: "https://github.com/dopamin/demo" },
      cookie,
    );
    const body = json as SubdomainPlanProposalResponse;

    expect(status).toBe(200);
    expect(body.domain).toBe("demo.com");
    expect(body.repoUrl).toBe("https://github.com/dopamin/demo");
    expect(body.items.map((i) => i.host)).toEqual(["www", "api", "docs"]);
    expect(body.policy).toBe(PROPOSAL.policy);
    // 「保存前」なので subdomain_plans には何も入らない
    expect(await db.$count(schema.subdomainPlans)).toBe(0);
  });

  it("AI 呼び出しが ai_logs に記録される（AC-14-1）", async () => {
    const { user, cookie } = await createTestSession(db);
    await seedDomain(user.id);
    setAiModelFactoryForTesting(() => proposalModel());

    await post(
      "demo.com",
      { repoUrl: "https://github.com/dopamin/demo" },
      cookie,
    );

    const rows = await db.select().from(schema.aiLogs);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: user.id,
      feature: "subdomain_plan",
      status: "success",
    });
    expect(rows[0]?.inputSummary).toContain("demo.com");
  });

  it("AC-13-2: 取得できないリポジトリ + 概要テキストなら提案できる", async () => {
    const { user, cookie } = await createTestSession(db);
    await seedDomain(user.id);
    process.env.GITHUB_MOCK_FAIL_MODE = "not_found";
    resetApiEnvCacheForTesting();
    setAiModelFactoryForTesting(() => proposalModel());

    const { status, json } = await post(
      "demo.com",
      {
        repoUrl: "https://github.com/dopamin/private",
        description: "個人ブログと写真ギャラリーのサイトです。",
      },
      cookie,
    );
    const body = json as SubdomainPlanProposalResponse;

    expect(status).toBe(200);
    expect(body.items).toHaveLength(3);
    // 解析できなかった URL も「何を入力したか」として返す
    expect(body.repoUrl).toBe("https://github.com/dopamin/private");
  });

  it("AC-13-2: 取得できず概要も無ければ「取得できません」（404）", async () => {
    const { user, cookie } = await createTestSession(db);
    await seedDomain(user.id);
    process.env.GITHUB_MOCK_FAIL_MODE = "not_found";
    resetApiEnvCacheForTesting();
    setAiModelFactoryForTesting(() => proposalModel());

    const { status, json } = await post(
      "demo.com",
      { repoUrl: "https://github.com/dopamin/private" },
      cookie,
    );

    expect(status).toBe(404);
    const body = json as { error: { code: string; message: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toContain("取得できません");
  });

  it("GitHub のレート制限は RATE_LIMITED（429）", async () => {
    const { user, cookie } = await createTestSession(db);
    await seedDomain(user.id);
    process.env.GITHUB_MOCK_FAIL_MODE = "rate_limited";
    resetApiEnvCacheForTesting();
    setAiModelFactoryForTesting(() => proposalModel());

    const { status, json } = await post(
      "demo.com",
      { repoUrl: "https://github.com/dopamin/demo" },
      cookie,
    );

    expect(status).toBe(429);
    expect((json as { error: { code: string } }).error.code).toBe(
      "RATE_LIMITED",
    );
  });

  it("概要テキストだけでも提案できる", async () => {
    const { user, cookie } = await createTestSession(db);
    await seedDomain(user.id);
    setAiModelFactoryForTesting(() => proposalModel());

    const { status, json } = await post(
      "demo.com",
      { description: "社内向けのダッシュボードです。" },
      cookie,
    );
    const body = json as SubdomainPlanProposalResponse;

    expect(status).toBe(200);
    expect(body.repoUrl).toBeNull();
  });

  it("repoUrl も description も無ければ VALIDATION_ERROR（400）", async () => {
    const { user, cookie } = await createTestSession(db);
    await seedDomain(user.id);

    const { status, json } = await post("demo.com", {}, cookie);

    expect(status).toBe(400);
    expect((json as { error: { code: string } }).error.code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("GitHub 以外の URL は VALIDATION_ERROR（400）", async () => {
    const { user, cookie } = await createTestSession(db);
    await seedDomain(user.id);

    const { status } = await post(
      "demo.com",
      { repoUrl: "https://gitlab.com/dopamin/demo" },
      cookie,
    );

    expect(status).toBe(400);
  });

  it("不正な項目は 1 件だけ落とし、残りを返す（#167）", async () => {
    const { user, cookie } = await createTestSession(db);
    await seedDomain(user.id);
    setAiModelFactoryForTesting(() =>
      proposalModel({
        policy: PROPOSAL.policy,
        items: [
          ...PROPOSAL.items,
          // A レコードなのに target がホスト名（プロンプトの例が混ざった形）
          {
            host: "app",
            purpose: "アプリ本体",
            recordType: "A",
            target: "cname.vercel-dns.com",
            priority: "recommended",
          },
        ],
      }),
    );

    const { status, json } = await post(
      "demo.com",
      { repoUrl: "https://github.com/dopamin/demo" },
      cookie,
    );
    const body = json as SubdomainPlanProposalResponse;

    expect(status).toBe(200);
    // 落ちるのは app の 1 件だけ。残り 3 件は提案として返る
    expect(body.items.map((i) => i.host)).toEqual(["www", "api", "docs"]);
  });

  it("落とした項目は構造化ログに残る（NFR-06）", async () => {
    const { user, cookie } = await createTestSession(db);
    await seedDomain(user.id);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    setAiModelFactoryForTesting(() =>
      proposalModel({
        policy: PROPOSAL.policy,
        items: [
          ...PROPOSAL.items,
          {
            host: "app",
            purpose: "アプリ本体",
            recordType: "A",
            target: "cname.vercel-dns.com",
            priority: "recommended",
          },
        ],
      }),
    );

    await post(
      "demo.com",
      { repoUrl: "https://github.com/dopamin/demo" },
      cookie,
    );

    const lines = logSpy.mock.calls
      .map((call) => (typeof call[0] === "string" ? call[0] : ""))
      .filter((line) => line.includes("subdomain_plan_items_dropped"));
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] ?? "{}") as {
      level: string;
      kept: number;
      dropped: { host: string; reason: string }[];
    };
    expect(line.level).toBe("warn");
    expect(line.kept).toBe(3);
    expect(line.dropped.map((d) => d.host)).toEqual(["app"]);
    // AI の素の出力（落とした項目を含む）は ai_logs にも残る（AC-14-1）
    const rows = await db.select().from(schema.aiLogs);
    expect(JSON.stringify(rows[0]?.output)).toContain("app");
  });

  it("落とした結果 3 件未満になれば AI_UNAVAILABLE（503）", async () => {
    const { user, cookie } = await createTestSession(db);
    await seedDomain(user.id);
    setAiModelFactoryForTesting(() =>
      proposalModel({
        policy: PROPOSAL.policy,
        items: [
          ...PROPOSAL.items.slice(0, 2),
          {
            host: "docs.example",
            purpose: "仕様書",
            recordType: "CNAME",
            target: "dopamin.github.io",
            priority: "optional",
          },
        ],
      }),
    );

    const { status, json } = await post(
      "demo.com",
      { repoUrl: "https://github.com/dopamin/demo" },
      cookie,
    );

    expect(status).toBe(503);
    expect((json as { error: { code: string } }).error.code).toBe(
      "AI_UNAVAILABLE",
    );
  });

  it("www を含まない提案は再検証で弾かれ AI_UNAVAILABLE（503）", async () => {
    const { user, cookie } = await createTestSession(db);
    await seedDomain(user.id);
    setAiModelFactoryForTesting(() =>
      proposalModel({
        policy: "www を出さない",
        items: [
          {
            host: "api",
            purpose: "API",
            recordType: "CNAME",
            target: "cname.vercel-dns.com",
            priority: "required",
          },
          {
            host: "docs",
            purpose: "docs",
            recordType: "CNAME",
            target: "dopamin.github.io",
            priority: "optional",
          },
          {
            host: "blog",
            purpose: "blog",
            recordType: "CNAME",
            target: "dopamin.github.io",
            priority: "optional",
          },
        ],
      }),
    );

    const { status, json } = await post(
      "demo.com",
      { repoUrl: "https://github.com/dopamin/demo" },
      cookie,
    );

    expect(status).toBe(503);
    expect((json as { error: { code: string } }).error.code).toBe(
      "AI_UNAVAILABLE",
    );
  });

  it("保有していないドメインは 404（NFR-04）", async () => {
    const { cookie } = await createTestSession(db);
    setAiModelFactoryForTesting(() => proposalModel());

    const { status } = await post(
      "notmine.com",
      { repoUrl: "https://github.com/dopamin/demo" },
      cookie,
    );

    expect(status).toBe(404);
  });

  it("他ユーザーのドメインは 403（NFR-04）", async () => {
    const owner = await createTestSession(db, { displayName: "所有者" });
    const { cookie } = await createTestSession(db, { displayName: "別の人" });
    await seedDomain(owner.user.id, "other.com");
    setAiModelFactoryForTesting(() => proposalModel());

    const { status } = await post(
      "other.com",
      { repoUrl: "https://github.com/dopamin/demo" },
      cookie,
    );

    expect(status).toBe(403);
  });

  it("未認証は 401", async () => {
    const res = await app.request("/api/v1/domains/demo.com/subdomain-plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "x" }),
    });
    expect(res.status).toBe(401);
  });
});
