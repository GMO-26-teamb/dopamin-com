import { ERROR_CODES, ERROR_STATUS } from "@dopamin/shared";
import { describe, expect, it } from "vitest";
import { ApiException } from "./errors";

describe("ApiException（§10.3 統一エラー）", () => {
  it.each(ERROR_CODES)("%s の status は ERROR_STATUS と一致する", (code) => {
    expect(new ApiException(code, "x").status).toBe(ERROR_STATUS[code]);
  });

  it("retryable の既定は false、options で true にできる", () => {
    expect(new ApiException("INTERNAL", "x").retryable).toBe(false);
    expect(
      new ApiException("REGISTRY_TIMEOUT", "x", undefined, { retryable: true })
        .retryable,
    ).toBe(true);
  });

  it("details は object 以外（配列）もそのまま保持する", () => {
    const issues = [{ path: "period", message: "1 以上を指定してください" }];
    const exception = new ApiException("VALIDATION_ERROR", "x", issues);
    expect(exception.details).toBe(issues);
  });

  it("Error として扱える（name / message / instanceof）", () => {
    const exception = new ApiException("NOT_FOUND", "見つかりません。");
    expect(exception).toBeInstanceOf(Error);
    expect(exception.name).toBe("ApiException");
    expect(exception.message).toBe("見つかりません。");
  });
});
