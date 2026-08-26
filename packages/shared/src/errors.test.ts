import { describe, expect, it } from "vitest";
import {
  apiErrorSchema,
  ERROR_CODES,
  ERROR_STATUS,
  errorCodeSchema,
} from "./errors";

const FR01_CODES = [
  "CHALLENGE_NOT_FOUND",
  "VERIFICATION_FAILED",
  "CREDENTIAL_NOT_FOUND",
  "LAST_PASSKEY",
] as const;

describe("ERROR_CODES / errorCodeSchema（§10.3 v0.1.8）", () => {
  it("§10.3 の 13 種 + FR-01 の 4 種 = 17 種を定義する", () => {
    expect(ERROR_CODES).toHaveLength(17);
    expect(ERROR_CODES).toEqual(expect.arrayContaining([...FR01_CODES]));
  });

  it.each(ERROR_CODES)("%s を受理する", (code) => {
    expect(errorCodeSchema.safeParse(code).success).toBe(true);
  });

  it("未知のコードは拒否する", () => {
    expect(errorCodeSchema.safeParse("UNKNOWN_ERROR").success).toBe(false);
    expect(errorCodeSchema.safeParse("").success).toBe(false);
  });
});

describe("ERROR_STATUS", () => {
  it("全 ERROR_CODES に HTTP ステータス（4xx / 5xx）がある", () => {
    for (const code of ERROR_CODES) {
      const status = ERROR_STATUS[code];
      expect(status, code).toBeGreaterThanOrEqual(400);
      expect(status, code).toBeLessThan(600);
    }
    expect(Object.keys(ERROR_STATUS).sort()).toEqual([...ERROR_CODES].sort());
  });

  it("docs/requirements.md §10.3 の表と一致する", () => {
    expect(ERROR_STATUS).toEqual({
      VALIDATION_ERROR: 400,
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      OPERATION_NOT_ALLOWED: 409,
      REGISTRY_REJECTED: 422,
      REGISTRY_TIMEOUT: 504,
      REGISTRY_UNAVAILABLE: 502,
      REGISTRY_SPEC_MISMATCH: 502,
      AI_UNAVAILABLE: 503,
      RATE_LIMITED: 429,
      INTERNAL: 500,
      CHALLENGE_NOT_FOUND: 400,
      VERIFICATION_FAILED: 401,
      CREDENTIAL_NOT_FOUND: 401,
      LAST_PASSKEY: 409,
    });
  });
});

describe("apiErrorSchema（§10.3 統一エラー形式）", () => {
  const base = { code: "INTERNAL", message: "x", retryable: false } as const;

  it("§10.3 のレスポンス例を受理し、そのまま返す", () => {
    const body = {
      error: {
        code: "REGISTRY_TIMEOUT",
        message: "Kitaqsign が応答しませんでした。",
        retryable: true,
        registry: "kitaqsign",
        registryCode: "2400",
        requestId: "req_01J...",
      },
    };
    expect(apiErrorSchema.parse(body)).toEqual(body);
  });

  it("必須フィールド（code / message / retryable）だけでも受理する", () => {
    expect(apiErrorSchema.safeParse({ error: base }).success).toBe(true);
  });

  it("retryable 無しの body は拒否する（§10.3 では必須）", () => {
    expect(
      apiErrorSchema.safeParse({ error: { code: "INTERNAL", message: "x" } })
        .success,
    ).toBe(false);
  });

  it("details は object / 配列 / 文字列のどれでも受理する", () => {
    const candidates: unknown[] = [
      { statuses: ["serverHold"] },
      [{ path: "period", message: "1 以上を指定してください" }],
      "raw",
    ];
    for (const details of candidates) {
      expect(
        apiErrorSchema.safeParse({ error: { ...base, details } }).success,
        JSON.stringify(details),
      ).toBe(true);
    }
  });

  it("registry は registryIdSchema で検証する", () => {
    expect(
      apiErrorSchema.safeParse({ error: { ...base, registry: "kitaqsign" } })
        .success,
    ).toBe(true);
    expect(
      apiErrorSchema.safeParse({ error: { ...base, registry: "onamae" } })
        .success,
    ).toBe(false);
  });

  it.each(FR01_CODES)("FR-01 のコード %s を受理する", (code) => {
    expect(apiErrorSchema.safeParse({ error: { ...base, code } }).success).toBe(
      true,
    );
  });

  it.each([
    ["code 欠落", { message: "x", retryable: false }],
    ["message 欠落", { code: "INTERNAL", retryable: false }],
    ["code が未知の値", { code: "TEAPOT", message: "x", retryable: false }],
  ])("%s は拒否する", (_label, error) => {
    expect(apiErrorSchema.safeParse({ error }).success).toBe(false);
  });
});
