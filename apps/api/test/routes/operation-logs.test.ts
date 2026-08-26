import { type Db, schema } from "@dopamin/db";
import { asc } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import app from "../../src/index";
import { setDbForTesting } from "../../src/lib/db";
import { resetApiEnvCacheForTesting } from "../../src/lib/env";
import { setRegistrySetForTesting } from "../../src/lib/registries";
import { createTestDb, resetTestDb } from "../helpers/db";
import { createTestSession } from "../helpers/session";

/**
 * 操作ログ（FR-15）の統合テスト。setRegistrySetForTesting を使わず、
 * 環境変数（REGISTRY_MODE=mock）から本番と同じ配線（onCall / makeClTrid 込み）で
 * RegistrySet を構築させ、HTTP リクエスト → mock アダプタ → observer →
 * operation_logs INSERT（pglite）までの全経路を検証する。
 */

let db: Db;
let closeDb: () => Promise<void>;
let consoleLog: MockInstance<typeof console.log>;

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
  process.env.REGISTRY_MODE = "mock";
  delete process.env.MOCK_REGISTRY_FAIL_MODE;
  // 環境変数から onCall 配線込みで再構築させる
  resetApiEnvCacheForTesting();
  setRegistrySetForTesting(null);
  // 構造化ログでテスト出力が汚れないよう抑止しつつ、内容の検証にも使う
  consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  setRegistrySetForTesting(null);
  resetApiEnvCacheForTesting();
  vi.restoreAllMocks();
});

async function selectLogs() {
  return db
    .select()
    .from(schema.operationLogs)
    .orderBy(asc(schema.operationLogs.createdAt));
}

describe("operation_logs への永続化（FR-15）", () => {
  it("認証済みの check が userId・clTRID（request_id）付きで 1 行記録される", async () => {
    const { user, cookie } = await createTestSession(db);
    const res = await app.request("/api/v1/domains/check", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-request-id": "reqtest123",
      },
      body: JSON.stringify({ names: ["example.com"] }),
    });
    expect(res.status).toBe(200);

    const rows = await selectLogs();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: user.id,
      // request_id = X-Cl-TRID（Hono requestId + 連番）で API リクエストと相関できる（§9.1）
      requestId: "reqtest123-1",
      svTrid: null,
      registry: "mock",
      command: "check",
      status: "success",
      errorCode: null,
    });
    expect(rows[0]?.latencyMs).toBeGreaterThanOrEqual(0);

    // NFR-06: Vercel で見る単一行 JSON が console に出る
    const line = consoleLog.mock.calls
      .map((call) => {
        try {
          return JSON.parse(String(call[0])) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.type === "operation_log");
    expect(line).toMatchObject({
      level: "info",
      type: "operation_log",
      requestId: "reqtest123",
      clTrid: "reqtest123-1",
      command: "check",
      status: "success",
    });
    expect(line).not.toHaveProperty("request");
  });

  it("未認証の /health（hello）は userId null で記録される", async () => {
    const res = await app.request("/api/v1/health");
    expect(res.status).toBe(200);
    const rows = await selectLogs();
    const hello = rows.find((row) => row.command === "hello");
    expect(hello).toMatchObject({
      userId: null,
      registry: "mock",
      status: "success",
    });
  });

  it("タイムアウトはエラー種別付きで記録される（AC-15-1）", async () => {
    process.env.MOCK_REGISTRY_FAIL_MODE = "timeout";
    resetApiEnvCacheForTesting();
    setRegistrySetForTesting(null);

    const { cookie } = await createTestSession(db);
    await app.request("/api/v1/domains/check", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ names: ["example.com"] }),
    });

    const rows = await selectLogs();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      command: "check",
      status: "timeout",
      errorCode: "REGISTRY_TIMEOUT",
    });
  });

  it("AuthCode は *** にマスクして保存される（AC-15-2）", async () => {
    const { cookie } = await createTestSession(db);
    // mock に存在しないドメインへの移管申請 → NOT_FOUND でも記録は残り、authCode はマスクされる
    const res = await app.request("/api/v1/transfers", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "example.com", authCode: "raw-auth-code" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);

    const rows = await selectLogs();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      command: "transfer_request",
      domainName: "example.com",
      status: "error",
    });
    const requestJson = JSON.stringify(rows[0]?.request);
    expect(requestJson).toContain('"***"');
    expect(requestJson).not.toContain("raw-auth-code");
  });

  it("同一リクエスト内の複数呼び出しは request_id の連番で相関できる", async () => {
    const { cookie } = await createTestSession(db);
    // create は mock では 1 レコードだが、check を 2 レジストリ分に分けるのは
    // mock モードでは単一アダプタのため、renew の前提 info + renew の 2 呼び出しで検証する
    await app.request("/api/v1/domains", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-request-id": "reqcreate",
      },
      body: JSON.stringify({ name: "multi.com", periodYears: 1 }),
    });
    const rows = await selectLogs();
    // POST /domains は check（重複確認）→ create の順に呼ぶ
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const requestIds = rows.map((row) => row.requestId);
    expect(requestIds).toEqual(rows.map((_, i) => `reqcreate-${i + 1}`));
  });
});
