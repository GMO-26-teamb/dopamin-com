import type { Db } from "@dopamin/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_ERROR_MESSAGE_MAX_LENGTH,
  type AiCallRecord,
  AiLogWriteTimeoutError,
  buildAiLogConsoleLine,
  buildAiLogRow,
  recordAiLog,
} from "../../src/services/ai-log.service";

/** buildAiLogRow / buildAiLogConsoleLine の純関数テストと recordAiLog の上限時間（FR-14 §9.1）。 */

const SUCCESS: AiCallRecord = {
  userId: "user-1",
  feature: "domain_candidates",
  provider: "google",
  model: "gemini-2.5-flash",
  input: { nickname: "どぱみん", exclude: ["dopamin.com"] },
  output: { candidates: [{ name: "dopamin.dev", reason: "短くて覚えやすい" }] },
  tokensIn: 320,
  tokensOut: 128,
  latencyMs: 1_234,
  status: "success",
};

const FAILURE: AiCallRecord = {
  ...SUCCESS,
  output: undefined,
  tokensIn: null,
  tokensOut: null,
  latencyMs: 10_000,
  status: "error",
  errorMessage: "HTTP 503: upstream unavailable",
};

const CONTEXT = { requestId: "req_abc" };

describe("buildAiLogRow（§9.1 列マッピング + AC-14-2 要約）", () => {
  it("record を ai_logs の行に写像する", () => {
    expect(buildAiLogRow(SUCCESS)).toEqual({
      userId: "user-1",
      feature: "domain_candidates",
      provider: "google",
      model: "gemini-2.5-flash",
      inputSummary: '{"nickname":"どぱみん","exclude":["dopamin.com"]}',
      output: SUCCESS.output,
      tokensIn: 320,
      tokensOut: 128,
      latencyMs: 1_234,
      status: "success",
      errorMessage: null,
    });
  });

  it("入力は 200 字以内に切り詰める（AC-14-2: プロンプト全文は保存しない）", () => {
    const row = buildAiLogRow({ ...SUCCESS, input: "あ".repeat(500) });
    const summary = row.inputSummary ?? "";
    expect(summary).toHaveLength(200);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("失敗ログは output が null で error_message が入る", () => {
    const row = buildAiLogRow(FAILURE);
    expect(row.output).toBeNull();
    expect(row.tokensIn).toBeNull();
    expect(row.tokensOut).toBeNull();
    expect(row.status).toBe("error");
    expect(row.errorMessage).toBe("HTTP 503: upstream unavailable");
  });

  it("プロバイダが返す長大なエラーは上限まで畳む（DB 肥大防止）", () => {
    const row = buildAiLogRow({ ...FAILURE, errorMessage: "e".repeat(1_000) });
    expect(row.errorMessage).toHaveLength(AI_ERROR_MESSAGE_MAX_LENGTH);
  });
});

describe("buildAiLogConsoleLine（NFR-06 構造化ログ）", () => {
  it("成功は level info、入出力（要約・構造化出力）は載せない", () => {
    const line = buildAiLogConsoleLine(SUCCESS, CONTEXT);
    expect(line).toMatchObject({
      level: "info",
      type: "ai_log",
      requestId: "req_abc",
      userId: "user-1",
      feature: "domain_candidates",
      provider: "google",
      model: "gemini-2.5-flash",
      status: "success",
      tokensIn: 320,
      tokensOut: 128,
      latencyMs: 1_234,
    });
    expect(line).not.toHaveProperty("inputSummary");
    expect(line).not.toHaveProperty("output");
    expect(JSON.stringify(line)).not.toContain("どぱみん");
    expect(JSON.stringify(line)).not.toContain("dopamin.dev");
  });

  it("失敗は level warn でエラーメッセージが載る", () => {
    const line = buildAiLogConsoleLine(FAILURE, CONTEXT);
    expect(line.level).toBe("warn");
    expect(line.errorMessage).toBe("HTTP 503: upstream unavailable");
  });
});

describe("recordAiLog（INSERT の上限時間）", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("上限内に INSERT が完了すれば resolve し、行をそのまま渡す", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const db = { insert: vi.fn(() => ({ values })) } as unknown as Db;
    const row = buildAiLogRow(SUCCESS);

    await expect(recordAiLog(db, row)).resolves.toBeUndefined();
    expect(values).toHaveBeenCalledWith(row);
  });

  it("timeoutMs を超えても INSERT が終わらなければ AiLogWriteTimeoutError で reject する", async () => {
    vi.useFakeTimers();
    // DB に到達できず接続待ちが続く状況（postgres-js の connect_timeout まで返らない）を模す
    const db = {
      insert: () => ({ values: () => new Promise<never>(() => {}) }),
    } as unknown as Db;

    const pending = recordAiLog(db, buildAiLogRow(SUCCESS), 3_000);
    const assertion = expect(pending).rejects.toBeInstanceOf(
      AiLogWriteTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(3_000);
    await assertion;
  });
});
