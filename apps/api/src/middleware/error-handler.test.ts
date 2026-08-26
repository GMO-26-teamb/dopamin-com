import { RegistryError } from "@dopamin/registry";
import { apiErrorSchema } from "@dopamin/shared";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiException } from "../lib/errors";
import type { AppEnv } from "../types";
import { errorHandler, notFoundHandler } from "./error-handler";
import { requestId } from "./request-id";

/** errorHandler だけを検証する最小の app。/boom で thrower を投げる。 */
function buildApp(thrower: () => never) {
  const app = new Hono<AppEnv>().use(requestId).get("/boom", () => thrower());
  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  return app;
}

async function boom(thrower: () => never) {
  const res = await buildApp(thrower).request("/boom", {
    headers: { "x-request-id": "req_test" },
  });
  const body = apiErrorSchema.parse(await res.json());
  return { res, body };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("errorHandler（§10.3 単一経路）", () => {
  it("ApiException は ERROR_STATUS のステータスで、retryable / details をそのまま返す", async () => {
    const { res, body } = await boom(() => {
      throw new ApiException(
        "LAST_PASSKEY",
        "最後のパスキーは削除できません。",
        { remaining: 1 },
        { retryable: true },
      );
    });
    expect(res.status).toBe(409);
    expect(body.error).toEqual({
      code: "LAST_PASSKEY",
      message: "最後のパスキーは削除できません。",
      retryable: true,
      requestId: "req_test",
      details: { remaining: 1 },
    });
  });

  it("配列の details（jsonValidator の issues）も載せる", async () => {
    const issues = [{ path: "period", message: "1 以上を指定してください" }];
    const { res, body } = await boom(() => {
      throw new ApiException(
        "VALIDATION_ERROR",
        "入力内容に誤りがあります。",
        issues,
      );
    });
    expect(res.status).toBe(400);
    expect(body.error.details).toEqual(issues);
  });

  it("details が無ければ details キーを出さず、retryable は false", async () => {
    const { res, body } = await boom(() => {
      throw new ApiException("UNAUTHORIZED", "ログインが必要です。");
    });
    expect(res.status).toBe(401);
    expect(body.error.retryable).toBe(false);
    expect("details" in body.error).toBe(false);
  });

  it("HTTPException はステータスから統一コードに写像する", async () => {
    const { res, body } = await boom(() => {
      throw new HTTPException(400, { message: "Malformed JSON" });
    });
    expect(res.status).toBe(400);
    expect(body.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Malformed JSON",
      retryable: false,
      requestId: "req_test",
    });
  });

  it("RegistryError は正規化コード・registry・registryCode 付きで返す", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { res, body } = await boom(() => {
      throw new RegistryError({
        code: "REGISTRY_TIMEOUT",
        registry: "kitaqsign",
        message: "info: レジストリが 5000ms 以内に応答しませんでした",
        reason: "socket hang up",
      });
    });

    // ステータスは ERROR_STATUS 由来（§10.3。REGISTRY_ERROR_HTTP はそこから導出）
    expect(res.status).toBe(504);
    expect(body.error).toMatchObject({
      code: "REGISTRY_TIMEOUT",
      registry: "kitaqsign",
      // 繋がらない系は再送してよい
      retryable: true,
      requestId: "req_test",
    });
    // FR-18 / NFR-03: レジストリの生メッセージ・reason はサーバーログにだけ残す
    const text = JSON.stringify(body);
    expect(text).not.toContain("socket hang up");
    expect(text).not.toContain("5000ms");
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("RegistryError の result code は文字列の registryCode として載る", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { res, body } = await boom(() => {
      throw new RegistryError({
        code: "REGISTRY_REJECTED",
        registry: "kitaqnic",
        message: "transfer:request: AuthCode が一致しません",
        registryCode: 2202,
        command: "transfer_request",
      });
    });

    expect(res.status).toBe(422);
    expect(body.error).toMatchObject({
      code: "REGISTRY_REJECTED",
      registry: "kitaqnic",
      // int の result code は string にして返す（§10.3）
      registryCode: "2202",
      retryable: false,
    });
    // AC-12-2 / #47: result code から原因を特定できる場合は文言を出し分ける
    expect(body.error.message).toBe("AuthCode が正しくありません。");
  });

  it("想定外の Error は 500 INTERNAL で message を漏らさない（NFR-06）", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { res, body } = await boom(() => {
      throw new Error("boom-secret-detail");
    });
    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).not.toContain("boom-secret-detail");
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("未定義ルートは 404 NOT_FOUND の統一形式", async () => {
    const res = await buildApp(() => {
      throw new Error("unreachable");
    }).request("/nowhere");
    expect(res.status).toBe(404);
    const body = apiErrorSchema.parse(await res.json());
    expect(body.error).toMatchObject({ code: "NOT_FOUND", retryable: false });
  });
});
