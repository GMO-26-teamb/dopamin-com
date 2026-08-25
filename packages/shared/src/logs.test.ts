import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  aiLogItemSchema,
  aiLogsResponseSchema,
  operationLogItemSchema,
  operationLogsResponseSchema,
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
  pagedResponseSchema,
  paginationQuerySchema,
} from "./logs";

describe("paginationQuerySchema", () => {
  it("既定は limit 20 / cursor 無し", () => {
    expect(paginationQuerySchema.parse({})).toEqual({
      limit: PAGINATION_DEFAULT_LIMIT,
    });
  });

  it("クエリ文字列の limit を数値に変換する", () => {
    expect(paginationQuerySchema.parse({ limit: "50" })).toEqual({ limit: 50 });
  });

  it("1〜100 の範囲外は弾く", () => {
    expect(paginationQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(
      paginationQuerySchema.safeParse({ limit: PAGINATION_MAX_LIMIT }).success,
    ).toBe(true);
    expect(
      paginationQuerySchema.safeParse({ limit: PAGINATION_MAX_LIMIT + 1 })
        .success,
    ).toBe(false);
    expect(paginationQuerySchema.safeParse({ limit: 1.5 }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ limit: "abc" }).success).toBe(
      false,
    );
  });

  it("cursor は不透明な文字列として通す（空文字は不可）", () => {
    expect(
      paginationQuerySchema.parse({ cursor: "2026-08-26T00:00:00.000Z" }),
    ).toEqual({
      limit: PAGINATION_DEFAULT_LIMIT,
      cursor: "2026-08-26T00:00:00.000Z",
    });
    expect(paginationQuerySchema.safeParse({ cursor: "" }).success).toBe(false);
  });
});

describe("pagedResponseSchema", () => {
  const schema = pagedResponseSchema(z.object({ id: z.string() }));

  it("items と nextCursor を持つ", () => {
    expect(schema.parse({ items: [{ id: "a" }], nextCursor: "cur" })).toEqual({
      items: [{ id: "a" }],
      nextCursor: "cur",
    });
  });

  it("最終ページの nextCursor は null", () => {
    expect(schema.parse({ items: [], nextCursor: null })).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("nextCursor の省略は許さない（有無を必ず明示する）", () => {
    expect(schema.safeParse({ items: [] }).success).toBe(false);
  });
});

const operationLog = {
  id: "0198f0d0-0000-7000-8000-000000000001",
  at: "2026-08-26T01:02:03.000Z",
  command: "transfer_request",
  registry: "kitaqsign",
  domainName: "dopamin-demo-a1b2.com",
  status: "error",
  errorCode: "REGISTRY_REJECTED",
  registryCode: "2202",
  latencyMs: 812,
  requestId: "req_01J",
  request: { authInfo: "***" },
  response: { result: { code: 2202 } },
};

describe("operationLogItemSchema", () => {
  it("§9.1 operation_logs の行を受理する", () => {
    expect(operationLogItemSchema.parse(operationLog)).toEqual(operationLog);
  });

  it("成功時は errorCode / registryCode / domainName を null にできる", () => {
    const success = {
      ...operationLog,
      command: "hello",
      domainName: null,
      status: "success",
      errorCode: null,
      registryCode: null,
      requestId: null,
      request: null,
      response: null,
    };
    expect(operationLogItemSchema.parse(success)).toEqual(success);
  });

  it("enum 外の command / status / errorCode を弾く", () => {
    expect(
      operationLogItemSchema.safeParse({
        ...operationLog,
        command: "rotate-auth-info",
      }).success,
    ).toBe(false);
    expect(
      operationLogItemSchema.safeParse({ ...operationLog, status: "failed" })
        .success,
    ).toBe(false);
    expect(
      operationLogItemSchema.safeParse({ ...operationLog, errorCode: "OOPS" })
        .success,
    ).toBe(false);
  });

  it("at は ISO 8601 のみ", () => {
    expect(
      operationLogItemSchema.safeParse({ ...operationLog, at: "2026/08/26" })
        .success,
    ).toBe(false);
    expect(
      operationLogItemSchema.safeParse({
        ...operationLog,
        at: "2026-08-26T10:02:03+09:00",
      }).success,
    ).toBe(true);
  });

  it("latencyMs は 0 以上の整数", () => {
    expect(
      operationLogItemSchema.safeParse({ ...operationLog, latencyMs: -1 })
        .success,
    ).toBe(false);
  });
});

const aiLog = {
  id: "0198f0d0-0000-7000-8000-000000000002",
  at: "2026-08-26T01:02:03.000Z",
  feature: "domain_candidates",
  provider: "google",
  model: "gemini-2.5-flash",
  inputSummary: "ニックネーム: ドパ民",
  outputSummary: '{"candidates":["dopamin","dopamine"]}',
  status: "success",
  errorMessage: null,
  latencyMs: 1240,
  tokensIn: 320,
  tokensOut: 180,
  output: { candidates: ["dopamin", "dopamine"] },
};

describe("aiLogItemSchema", () => {
  it("§9.1 ai_logs の行を受理する", () => {
    expect(aiLogItemSchema.parse(aiLog)).toEqual(aiLog);
  });

  it("トークン数が取得できない場合は null", () => {
    const withoutTokens = { ...aiLog, tokensIn: null, tokensOut: null };
    expect(aiLogItemSchema.parse(withoutTokens)).toEqual(withoutTokens);
  });

  it("失敗も記録できる（AC-14-1）", () => {
    const failed = {
      ...aiLog,
      status: "error",
      errorMessage: "AI_UNAVAILABLE",
      output: null,
    };
    expect(aiLogItemSchema.parse(failed)).toEqual(failed);
  });

  it("enum 外の feature / provider / status を弾く", () => {
    expect(
      aiLogItemSchema.safeParse({ ...aiLog, feature: "chat" }).success,
    ).toBe(false);
    expect(
      aiLogItemSchema.safeParse({ ...aiLog, provider: "openai" }).success,
    ).toBe(false);
    expect(
      aiLogItemSchema.safeParse({ ...aiLog, status: "timeout" }).success,
    ).toBe(false);
  });
});

describe("ログ一覧のレスポンス", () => {
  it("operations は { items, nextCursor }", () => {
    const body = { items: [operationLog], nextCursor: null };
    expect(operationLogsResponseSchema.parse(body)).toEqual(body);
  });

  it("ai は { items, nextCursor }", () => {
    const body = { items: [aiLog], nextCursor: "0198f0d0" };
    expect(aiLogsResponseSchema.parse(body)).toEqual(body);
  });
});
