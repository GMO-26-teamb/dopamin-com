import { type Db, schema } from "@dopamin/db";
import type { AiLogsResponse, OperationLogsResponse } from "@dopamin/shared";
import { sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import app from "../../src/index";
import { setDbForTesting } from "../../src/lib/db";
import { createTestDb, resetTestDb } from "../helpers/db";
import { createTestSession } from "../helpers/session";

/**
 * ログ一覧（docs/requirements.md §10.1 `/logs/*` / FR-14・FR-15）の統合テスト。
 * 行は pglite に直接 INSERT し、ページング境界と他ユーザー不可視を検証する。
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
  await resetTestDb(db);
});

const BASE_AT = Date.UTC(2026, 7, 27, 0, 0, 0);

/** `created_at` を 1 分刻みでずらして n 件の操作ログを入れる（古い順）。 */
async function seedOperationLogs(userId: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await db.insert(schema.operationLogs).values({
      userId,
      requestId: `req-${i}`,
      registry: "mock",
      command: "check",
      domainName: `demo${i}.com`,
      status: "success",
      latencyMs: i,
      request: { names: [`demo${i}.com`], apiKey: "***" },
      response: { available: true },
      createdAt: new Date(BASE_AT + i * 60_000),
    });
  }
}

async function seedAiLogs(userId: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await db.insert(schema.aiLogs).values({
      userId,
      feature: "domain_candidates",
      provider: "google",
      model: "gemini-2.5-flash",
      inputSummary: `ニックネーム: たく${i}`,
      output: { candidates: [{ sld: `taku${i}`, tld: "com" }] },
      tokensIn: 10,
      tokensOut: 20,
      latencyMs: 100 + i,
      status: "success",
      createdAt: new Date(BASE_AT + i * 60_000),
    });
  }
}

async function getJson<T>(path: string, cookie: string): Promise<T> {
  const res = await app.request(path, { headers: { cookie } });
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

describe("GET /logs/operations（FR-15）", () => {
  it("自分のログを新しい順に返し、既定の limit は 20", async () => {
    const { user, cookie } = await createTestSession(db);
    await seedOperationLogs(user.id, 25);

    const body = await getJson<OperationLogsResponse>(
      "/api/v1/logs/operations",
      cookie,
    );

    expect(body.items).toHaveLength(20);
    // 新しい順（最後に入れた demo24.com が先頭）
    expect(body.items[0]?.domainName).toBe("demo24.com");
    expect(body.items[19]?.domainName).toBe("demo5.com");
    expect(body.nextCursor).not.toBeNull();
    // マスク済みの request / response はそのまま返る（AC-15-2）
    expect(body.items[0]?.request).toEqual({
      names: ["demo24.com"],
      apiKey: "***",
    });
  });

  it("nextCursor で続きを取ると重複も欠落もなく、最終ページは nextCursor が null", async () => {
    const { user, cookie } = await createTestSession(db);
    await seedOperationLogs(user.id, 25);

    const first = await getJson<OperationLogsResponse>(
      "/api/v1/logs/operations?limit=10",
      cookie,
    );
    const second = await getJson<OperationLogsResponse>(
      `/api/v1/logs/operations?limit=10&cursor=${encodeURIComponent(first.nextCursor ?? "")}`,
      cookie,
    );
    const third = await getJson<OperationLogsResponse>(
      `/api/v1/logs/operations?limit=10&cursor=${encodeURIComponent(second.nextCursor ?? "")}`,
      cookie,
    );

    expect(first.items).toHaveLength(10);
    expect(second.items).toHaveLength(10);
    expect(third.items).toHaveLength(5);
    expect(third.nextCursor).toBeNull();

    const names = [...first.items, ...second.items, ...third.items].map(
      (item) => item.domainName,
    );
    expect(new Set(names).size).toBe(25);
  });

  it("ちょうど limit 件のときは次ページが無いので nextCursor は null", async () => {
    const { user, cookie } = await createTestSession(db);
    await seedOperationLogs(user.id, 10);

    const body = await getJson<OperationLogsResponse>(
      "/api/v1/logs/operations?limit=10",
      cookie,
    );

    expect(body.items).toHaveLength(10);
    expect(body.nextCursor).toBeNull();
  });

  it("created_at が同着でも id のタイブレークで重複しない", async () => {
    const { user, cookie } = await createTestSession(db);
    const at = new Date(BASE_AT);
    for (let i = 0; i < 4; i++) {
      await db.insert(schema.operationLogs).values({
        userId: user.id,
        registry: "mock",
        command: "info",
        domainName: `same${i}.com`,
        status: "success",
        latencyMs: 1,
        createdAt: at,
      });
    }

    const first = await getJson<OperationLogsResponse>(
      "/api/v1/logs/operations?limit=2",
      cookie,
    );
    const second = await getJson<OperationLogsResponse>(
      `/api/v1/logs/operations?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? "")}`,
      cookie,
    );

    const ids = [...first.items, ...second.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(4);
    expect(second.nextCursor).toBeNull();
  });

  it("他ユーザーのログとシステム起点（user_id NULL）の行は見えない", async () => {
    const { user, cookie } = await createTestSession(db);
    const other = await createTestSession(db, { displayName: "別の人" });
    await seedOperationLogs(user.id, 2);
    await seedOperationLogs(other.user.id, 3);
    await db.insert(schema.operationLogs).values({
      userId: null,
      registry: "mock",
      command: "hello",
      status: "success",
      latencyMs: 1,
    });

    const body = await getJson<OperationLogsResponse>(
      "/api/v1/logs/operations",
      cookie,
    );

    expect(body.items).toHaveLength(2);
    expect(body.items.every((item) => item.command === "check")).toBe(true);
  });

  it("未認証は 401", async () => {
    const res = await app.request("/api/v1/logs/operations");
    expect(res.status).toBe(401);
  });

  it("limit が上限超過なら VALIDATION_ERROR（400）", async () => {
    const { cookie } = await createTestSession(db);
    const res = await app.request("/api/v1/logs/operations?limit=101", {
      headers: { cookie },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("壊れた cursor は握りつぶさず VALIDATION_ERROR（400）", async () => {
    const { cookie } = await createTestSession(db);
    const res = await app.request(
      "/api/v1/logs/operations?cursor=not-a-cursor",
      {
        headers: { cookie },
      },
    );
    expect(res.status).toBe(400);
  });

  it.each([
    // 日時は妥当だが id が UUID でない（uuid 列との比較が 22P02 → 500 になっていた）
    "2026-08-27T00:00:00.000Z|xyz",
    // id は UUID だが日時が timestamptz に読めない
    "not-a-date|11111111-2222-4333-8444-555555555555",
  ])("復元できない cursor（%s）は 500 ではなく 400", async (raw) => {
    const { cookie } = await createTestSession(db);
    const cursor = Buffer.from(raw, "utf8").toString("base64url");
    const res = await app.request(
      `/api/v1/logs/operations?cursor=${encodeURIComponent(cursor)}`,
      { headers: { cookie } },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("created_at にマイクロ秒の端数があってもページ境界で行を取りこぼさない", async () => {
    const { user, cookie } = await createTestSession(db);
    // now() はマイクロ秒精度で入る。JS Date（ミリ秒）を経由するカーソルだと
    // 同一ミリ秒内の行が次ページの条件から漏れていた（回帰）
    for (const [i, micros] of ["123456", "123400", "123000"].entries()) {
      await db.insert(schema.operationLogs).values({
        userId: user.id,
        registry: "mock",
        command: "info",
        domainName: `micro${i}.com`,
        status: "success",
        latencyMs: 1,
        createdAt: sql`${`2026-08-27T00:00:00.${micros}Z`}::timestamptz`,
      });
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 4; page++) {
      const query: string =
        cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`;
      const body: OperationLogsResponse = await getJson<OperationLogsResponse>(
        `/api/v1/logs/operations?limit=1${query}`,
        cookie,
      );
      seen.push(...body.items.map((item) => item.domainName ?? ""));
      cursor = body.nextCursor;
      if (cursor === null) {
        break;
      }
    }

    // 3 行すべてが一度ずつ、マイクロ秒の降順で返る
    expect(seen).toEqual(["micro0.com", "micro1.com", "micro2.com"]);
    expect(cursor).toBeNull();
  });

  it("契約スキーマに通らない行は落として残りを返す", async () => {
    const { user, cookie } = await createTestSession(db);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await seedOperationLogs(user.id, 1);
    await db.insert(schema.operationLogs).values({
      userId: user.id,
      registry: "mock",
      // OPERATION_COMMANDS に無い語彙（語彙を狭めた変更で残った過去ログを模す）
      command: "legacy_command",
      status: "success",
      latencyMs: 1,
      createdAt: new Date(BASE_AT + 60_000),
    });

    const body = await getJson<OperationLogsResponse>(
      "/api/v1/logs/operations",
      cookie,
    );

    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.command).toBe("check");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("GET /logs/ai（FR-14）", () => {
  it("自分の AI ログを新しい順に返し、output から要約を作る", async () => {
    const { user, cookie } = await createTestSession(db);
    await seedAiLogs(user.id, 3);

    const body = await getJson<AiLogsResponse>("/api/v1/logs/ai", cookie);

    expect(body.items).toHaveLength(3);
    expect(body.items[0]?.inputSummary).toBe("ニックネーム: たく2");
    // output_summary 列は持たず、保存済みの構造化出力から読み出し時に作る（AC-14-2）
    expect(body.items[0]?.outputSummary).toBe(
      '{"candidates":[{"sld":"taku2","tld":"com"}]}',
    );
    expect(body.items[0]?.output).toEqual({
      candidates: [{ sld: "taku2", tld: "com" }],
    });
    expect(body.nextCursor).toBeNull();
  });

  it("失敗ログ（output・トークンが NULL）も返る（AC-14-1）", async () => {
    const { user, cookie } = await createTestSession(db);
    await db.insert(schema.aiLogs).values({
      userId: user.id,
      feature: "subdomain_plan",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      inputSummary: "demo.com",
      status: "error",
      errorMessage: "AI が 10000ms 以内に応答しませんでした",
      latencyMs: 10_000,
    });

    const body = await getJson<AiLogsResponse>("/api/v1/logs/ai", cookie);

    expect(body.items[0]).toMatchObject({
      feature: "subdomain_plan",
      status: "error",
      outputSummary: "",
      tokensIn: null,
      tokensOut: null,
    });
    expect(body.items[0]?.output).toBeNull();
  });

  it("他ユーザーの AI ログは見えない", async () => {
    const { user, cookie } = await createTestSession(db);
    const other = await createTestSession(db, { displayName: "別の人" });
    await seedAiLogs(user.id, 1);
    await seedAiLogs(other.user.id, 4);

    const body = await getJson<AiLogsResponse>("/api/v1/logs/ai", cookie);

    expect(body.items).toHaveLength(1);
  });

  it("ページングは operations と同じ規則で辿れる", async () => {
    const { user, cookie } = await createTestSession(db);
    await seedAiLogs(user.id, 5);

    const first = await getJson<AiLogsResponse>(
      "/api/v1/logs/ai?limit=2",
      cookie,
    );
    const second = await getJson<AiLogsResponse>(
      `/api/v1/logs/ai?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? "")}`,
      cookie,
    );
    const third = await getJson<AiLogsResponse>(
      `/api/v1/logs/ai?limit=2&cursor=${encodeURIComponent(second.nextCursor ?? "")}`,
      cookie,
    );

    expect(third.items).toHaveLength(1);
    expect(third.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items, ...third.items].map(
      (item) => item.id,
    );
    expect(new Set(ids).size).toBe(5);
  });

  it("未認証は 401", async () => {
    const res = await app.request("/api/v1/logs/ai");
    expect(res.status).toBe(401);
  });
});
