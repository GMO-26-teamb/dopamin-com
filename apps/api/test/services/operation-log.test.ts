import type { Db } from "@dopamin/db";
import type { RegistryCallRecord } from "@dopamin/registry";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOperationLogConsoleLine,
  buildOperationLogRow,
  OperationLogWriteTimeoutError,
  recordOperationLog,
} from "../../src/services/operation-log.service";

/** buildOperationLogRow / buildOperationLogConsoleLine の純関数テストと recordOperationLog の上限時間（FR-15 §9.1）。 */

const RECORD: RegistryCallRecord = {
  registry: "kitaqsign",
  command: "transfer_request",
  domainName: "example.com",
  clTrid: "req_abc-2",
  svTrid: "KQSGN-20260826-000001",
  status: "error",
  errorCode: "REGISTRY_REJECTED",
  registryCode: "2202",
  request: {
    method: "POST",
    path: "/domains/example.com/transfer/request",
    body: { op: "request", authInfo: "raw-auth-code" },
  },
  response: {
    message: "rejected",
    reason: "Invalid authorization",
    httpStatus: 422,
  },
  latencyMs: 321,
};

const CONTEXT = { requestId: "req_abc", userId: "user-1" };

describe("buildOperationLogRow（§9.1 列マッピング + AC-15-2 マスク）", () => {
  it("record と ALS コンテキストを operation_logs の行に写像する", () => {
    const row = buildOperationLogRow(RECORD, CONTEXT);
    expect(row).toMatchObject({
      userId: "user-1",
      // request_id は Hono の requestId ではなく X-Cl-TRID に送った値（§9.1）
      requestId: "req_abc-2",
      svTrid: "KQSGN-20260826-000001",
      registry: "kitaqsign",
      command: "transfer_request",
      domainName: "example.com",
      status: "error",
      errorCode: "REGISTRY_REJECTED",
      registryCode: "2202",
      latencyMs: 321,
    });
  });

  it("request / response の機密値を *** にマスクする（AC-15-2）", () => {
    const row = buildOperationLogRow(RECORD, CONTEXT);
    expect(row.request).toEqual({
      method: "POST",
      path: "/domains/example.com/transfer/request",
      body: { op: "request", authInfo: "***" },
    });
    expect(JSON.stringify(row)).not.toContain("raw-auth-code");
  });

  it("システム起点（未認証）の呼び出しは userId null で記録できる", () => {
    const row = buildOperationLogRow(RECORD, { requestId: null, userId: null });
    expect(row.userId).toBeNull();
  });
});

describe("buildOperationLogConsoleLine（NFR-06 構造化ログ）", () => {
  it("失敗は level warn、ペイロード（request / response）は載せない", () => {
    const line = buildOperationLogConsoleLine(RECORD, CONTEXT);
    expect(line).toMatchObject({
      level: "warn",
      type: "operation_log",
      requestId: "req_abc",
      clTrid: "req_abc-2",
      svTrid: "KQSGN-20260826-000001",
      command: "transfer_request",
      status: "error",
    });
    expect(line).not.toHaveProperty("request");
    expect(line).not.toHaveProperty("response");
    expect(JSON.stringify(line)).not.toContain("raw-auth-code");
  });

  it("成功は level info", () => {
    const line = buildOperationLogConsoleLine(
      { ...RECORD, status: "success", errorCode: null },
      CONTEXT,
    );
    expect(line.level).toBe("info");
  });
});

describe("recordOperationLog（INSERT の上限時間）", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("上限内に INSERT が完了すれば resolve し、行をそのまま渡す", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const db = { insert: vi.fn(() => ({ values })) } as unknown as Db;
    const row = buildOperationLogRow(RECORD, CONTEXT);

    await expect(recordOperationLog(db, row)).resolves.toBeUndefined();
    expect(values).toHaveBeenCalledWith(row);
  });

  it("timeoutMs を超えても INSERT が終わらなければ OperationLogWriteTimeoutError で reject する", async () => {
    vi.useFakeTimers();
    // DB に到達できず接続待ちが続く状況（postgres-js の connect_timeout まで返らない）を模す
    const db = {
      insert: () => ({ values: () => new Promise<never>(() => {}) }),
    } as unknown as Db;

    const pending = recordOperationLog(
      db,
      buildOperationLogRow(RECORD, CONTEXT),
      3_000,
    );
    const assertion = expect(pending).rejects.toBeInstanceOf(
      OperationLogWriteTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(3_000);
    await assertion;
  });
});
