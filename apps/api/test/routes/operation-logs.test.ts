import { type Db, schema } from "@dopamin/db";
import { MockRegistryAdapter } from "@dopamin/registry";
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
import {
  getRegistrySet,
  setRegistrySetForTesting,
} from "../../src/lib/registries";
import { setRetrySleepForTesting } from "../../src/lib/retry";
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
let consoleError: MockInstance<typeof console.error>;

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
  // INSERT 失敗のテストで差し替えた Db を毎回 pglite に戻す
  setDbForTesting(db);
  process.env.REGISTRY_MODE = "mock";
  delete process.env.MOCK_REGISTRY_FAIL_MODE;
  // 環境変数から onCall 配線込みで再構築させる
  resetApiEnvCacheForTesting();
  setRegistrySetForTesting(null);
  // 構造化ログでテスト出力が汚れないよう抑止しつつ、内容の検証にも使う
  consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  setRetrySleepForTesting(null);
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

/** console の spy から単一行 JSON を取り出し、type が一致する最初の行を返す。 */
function findConsoleLine(
  spy: MockInstance<typeof console.log>,
  type: string,
): Record<string, unknown> | undefined {
  return (
    spy.mock.calls
      .map((call) => {
        try {
          return JSON.parse(String(call[0])) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.type === type) ?? undefined
  );
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
    const line = findConsoleLine(consoleLog, "operation_log");
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

  it("INSERT が失敗しても API 応答は壊れず、根本原因だけを console.error に出す（ペイロードは載せない）", async () => {
    // drizzle の DrizzleQueryError 相当: message に全パラメータ、cause に DB ドライバのエラー
    const failingDb = {
      insert: () => ({
        values: () =>
          Promise.reject(
            new Error(
              'Failed query: insert into "operation_logs" ... params: raw-payload-should-not-leak',
              { cause: new Error("connect ECONNREFUSED 127.0.0.1:1") },
            ),
          ),
      }),
    } as unknown as Db;
    setDbForTesting(failingDb);

    const res = await app.request("/api/v1/health");
    expect(res.status).toBe(200);

    // console.log の operation_log 行は INSERT の成否に関係なく先に出る
    expect(findConsoleLine(consoleLog, "operation_log")).toMatchObject({
      command: "hello",
      status: "success",
    });
    const failed = findConsoleLine(consoleError, "operation_log_write_failed");
    expect(failed).toMatchObject({
      level: "error",
      registry: "mock",
      command: "hello",
      reason: "error",
      errorName: "Error",
      message: "connect ECONNREFUSED 127.0.0.1:1",
    });
    expect(JSON.stringify(failed)).not.toContain("raw-payload-should-not-leak");
  });

  it("タイムアウトはエラー種別付きで記録される（AC-15-1）", async () => {
    process.env.MOCK_REGISTRY_FAIL_MODE = "timeout";
    resetApiEnvCacheForTesting();
    setRegistrySetForTesting(null);
    // 参照系の自動再試行（#60）のバックオフでテストを待たせない
    setRetrySleepForTesting(() => Promise.resolve());

    const { cookie } = await createTestSession(db);
    await app.request("/api/v1/domains/check", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ names: ["example.com"] }),
    });

    // check は参照系なので初回 + 再試行 2 回まで投げる（§11.6 (e)）。
    // FR-15 は「全レジストリ呼び出し」を残すので、再試行も 1 回 1 行として記録される
    const rows = await selectLogs();
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toMatchObject({
        command: "check",
        status: "timeout",
        errorCode: "REGISTRY_TIMEOUT",
      });
    }
    // 試行ごとに clTRID（request_id）が別なので、ログから再試行を追える
    expect(new Set(rows.map((r) => r.requestId)).size).toBe(3);
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

/**
 * §9.1「Poll 由来などシステム起点の呼び出しは NULL」/ NFR-04（#250）。
 * Poll のキューはレジストラ単位で全ユーザー分が混ざるため、消化中の呼び出しを
 * 起動者の user_id で記録すると、他ユーザーのドメイン名が起動者の
 * `GET /logs/operations` に出てしまう（読み出しは `user_id = 自分` で引くだけ）。
 */
describe("Poll 由来の呼び出しの user_id（#250）", () => {
  it("消化を起動したユーザーではなく NULL で記録される", async () => {
    const { cookie } = await createTestSession(db);
    const res = await app.request("/api/v1/registry/poll", {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(200);

    const poll = (await selectLogs()).filter((row) => row.command === "poll");
    expect(poll.length).toBeGreaterThan(0);
    for (const row of poll) {
      expect(row.userId).toBeNull();
    }
  });

  it("他ユーザーが保有するドメインの transfer_query が起動者の操作ログに出ない", async () => {
    // B が victim.com を保有し、相手レジストラから移管申請を受けている
    const owner = await createTestSession(db, { displayName: "所有者B" });
    const created = await app.request("/api/v1/domains", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ name: "victim.com", period: 1 }),
    });
    expect(created.status).toBe(201);

    const adapter = getRegistrySet().forDomain("victim.com");
    if (!(adapter instanceof MockRegistryAdapter)) {
      throw new Error("mock モードのアダプタが取れませんでした");
    }
    adapter.simulateInboundTransferRequest("victim.com");
    await adapter.persist();

    // A が移管一覧を開くと、その裏で consumePoll() が B 宛の通知を消化する
    const invoker = await createTestSession(db, { displayName: "起動者A" });
    const transfers = await app.request("/api/v1/transfers", {
      headers: { cookie: invoker.cookie },
    });
    expect(transfers.status).toBe(200);

    const rows = await selectLogs();
    const pollOrigin = rows.filter((row) =>
      ["poll", "transfer_query", "ack"].includes(row.command),
    );
    // 消化で victim.com の transfer_query が実際に飛んでいる（前提の確認）
    expect(
      pollOrigin.some(
        (row) =>
          row.command === "transfer_query" && row.domainName === "victim.com",
      ),
    ).toBe(true);
    // どれも誰の操作でもない（システム起点）ので user_id は NULL
    for (const row of pollOrigin) {
      expect(row.userId).toBeNull();
    }
    // 起動者 A の操作ログに B のドメイン名は 1 件も出ない（NFR-04）
    const visibleToInvoker = rows.filter(
      (row) => row.userId === invoker.user.id,
    );
    expect(visibleToInvoker.map((row) => row.domainName)).not.toContain(
      "victim.com",
    );
  });

  it("同じリクエストでも消化のあとのユーザー操作は自分の user_id に戻る", async () => {
    // POST /domains/sync は consumePoll（システム起点）→ syncDomains（本人の操作）の順に走る。
    // 消化を包んだせいで後続まで NULL になっていないことを固定する
    const { user, cookie } = await createTestSession(db);
    expect(
      (
        await app.request("/api/v1/domains", {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ name: "mine.com", period: 1 }),
        })
      ).status,
    ).toBe(201);

    await db.delete(schema.operationLogs);
    const res = await app.request("/api/v1/domains/sync", {
      method: "POST",
      headers: { cookie, "x-request-id": "syncreq" },
    });
    expect(res.status).toBe(200);

    const rows = await selectLogs();
    // 消化ぶんは NULL
    for (const row of rows.filter((r) => r.command === "poll")) {
      expect(row.userId).toBeNull();
    }
    // 自分のドメインの再同期（info）は自分の user_id で残る
    const info = rows.filter((row) => row.command === "info");
    expect(info.length).toBeGreaterThan(0);
    for (const row of info) {
      expect(row.userId).toBe(user.id);
    }
    // clTRID の連番は境界をまたいでも通し番号のまま（§9.1 の相関キー）
    expect(rows.map((row) => row.requestId)).toEqual(
      rows.map((_, i) => `syncreq-${i + 1}`),
    );
  });
});
