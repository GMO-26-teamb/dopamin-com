import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { RegistryError } from "./errors";
import { type KitaqAdapterConfig, KitaqHttpClient } from "./http";

/**
 * KitaqHttpClient のユニットテスト。fetch をスタブし、
 * 2 段認証ヘッダ・URL 組み立て・fetch 失敗 → RegistryError の正規化を検証する。
 */

const CONFIG: KitaqAdapterConfig = {
  id: "kitaqsign",
  baseUrl: "https://epp.example.test",
  gateUser: "gate-user",
  gatePassword: "gate-pass",
  registrarId: "registrar-1",
  apiKey: "api-key-1",
};

const pingSchema = z.looseObject({ ping: z.string() });

const OK_BODY = JSON.stringify({
  result: { code: 1000, message: "OK" },
  resData: { ping: "pong" },
  trID: { svTRID: "KQSGN-TEST-1" },
});

const fetchMock = vi.fn<typeof fetch>();

function lastInit(): RequestInit {
  const call = fetchMock.mock.calls.at(-1);
  if (!call?.[1]) {
    throw new Error("fetch が呼ばれていません");
  }
  return call[1];
}

function headersOfLastCall(): Record<string, string> {
  return lastInit().headers as Record<string, string>;
}

async function commandError(promise: Promise<unknown>): Promise<RegistryError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof RegistryError) {
      return err;
    }
    throw err;
  }
  throw new Error("RegistryError が投げられませんでした");
}

function client(overrides?: Partial<KitaqAdapterConfig>): KitaqHttpClient {
  return new KitaqHttpClient({ ...CONFIG, ...overrides });
}

beforeEach(() => {
  fetchMock.mockReset();
  // Response の body は一度しか読めないため、呼び出しごとに新しく生成する
  fetchMock.mockImplementation(
    async () => new Response(OK_BODY, { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("リクエスト構築", () => {
  it("2 段認証ヘッダ（Basic ゲート + X-Registrar-Id / X-Api-Key）を送る", async () => {
    await client().command({
      method: "GET",
      path: "/sessions/hello",
      kind: "read",
      command: "hello",
      resDataSchema: pingSchema,
    });
    const headers = headersOfLastCall();
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("gate-user:gate-pass").toString("base64")}`,
    );
    expect(headers["X-Registrar-Id"]).toBe("registrar-1");
    expect(headers["X-Api-Key"]).toBe("api-key-1");
    expect(headers.Accept).toBe("application/json");
    // body の無い GET には Content-Type を付けない
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("body があるときのみ Content-Type: application/json を付ける", async () => {
    await client().command({
      method: "POST",
      path: "/domains/check",
      body: { names: ["example.com"] },
      kind: "read",
      command: "check",
      resDataSchema: pingSchema,
    });
    expect(headersOfLastCall()["Content-Type"]).toBe("application/json");
    expect(lastInit().body).toBe(JSON.stringify({ names: ["example.com"] }));
  });

  it("X-Cl-TRID は呼び出しごとに一意で 64 文字以内", async () => {
    const c = client();
    const options = {
      method: "GET",
      path: "/sessions/hello",
      kind: "read",
      command: "hello",
      resDataSchema: pingSchema,
    } as const;
    await c.command(options);
    const first = headersOfLastCall()["X-Cl-TRID"];
    await c.command(options);
    const second = headersOfLastCall()["X-Cl-TRID"];
    expect(first).toBeTruthy();
    expect((first ?? "").length).toBeLessThanOrEqual(64);
    expect(second).not.toBe(first);
  });

  it("baseUrl 末尾のスラッシュを除去して URL を組み立て、リダイレクトを拒否する", async () => {
    await client({ baseUrl: "https://epp.example.test///" }).command({
      method: "GET",
      path: "/sessions/hello",
      kind: "read",
      command: "hello",
      resDataSchema: pingSchema,
    });
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
      "https://epp.example.test/api/v1/epp/sessions/hello",
    );
    expect(lastInit().redirect).toBe("error");
    expect(lastInit().signal).toBeInstanceOf(AbortSignal);
  });
});

describe("fetch 失敗の正規化", () => {
  it("タイムアウト（TimeoutError）は REGISTRY_TIMEOUT（retryable）", async () => {
    fetchMock.mockRejectedValueOnce(
      new DOMException("The operation timed out", "TimeoutError"),
    );
    const err = await commandError(
      client().command({
        method: "GET",
        path: "/domains/example.com",
        kind: "read",
        command: "info",
        resDataSchema: pingSchema,
      }),
    );
    expect(err.code).toBe("REGISTRY_TIMEOUT");
    expect(err.retryable).toBe(true);
  });

  it("接続失敗は REGISTRY_UNAVAILABLE（retryable）", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const err = await commandError(
      client().command({
        method: "GET",
        path: "/domains/example.com",
        kind: "read",
        command: "info",
        resDataSchema: pingSchema,
      }),
    );
    expect(err.code).toBe("REGISTRY_UNAVAILABLE");
    expect(err.retryable).toBe(true);
    expect(err.reason).toBe("fetch failed");
  });

  it("ボディ読込の失敗も REGISTRY_UNAVAILABLE に正規化する", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      text: () => Promise.reject(new Error("connection reset")),
    } as unknown as Response);
    const err = await commandError(
      client().command({
        method: "GET",
        path: "/domains/example.com",
        kind: "read",
        command: "info",
        resDataSchema: pingSchema,
      }),
    );
    expect(err.code).toBe("REGISTRY_UNAVAILABLE");
  });
});

describe("レスポンス判定の接続（interpretEppResponse / parseResData 経由）", () => {
  it("非 JSON の 5xx は REGISTRY_UNAVAILABLE", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html>Service Unavailable</html>", { status: 503 }),
    );
    const err = await commandError(
      client().command({
        method: "GET",
        path: "/sessions/hello",
        kind: "read",
        command: "hello",
        resDataSchema: pingSchema,
      }),
    );
    expect(err.code).toBe("REGISTRY_UNAVAILABLE");
    expect(err.httpStatus).toBe(503);
  });

  it("非 JSON の 2xx は REGISTRY_SPEC_MISMATCH", async () => {
    fetchMock.mockResolvedValueOnce(new Response("OK", { status: 200 }));
    const err = await commandError(
      client().command({
        method: "GET",
        path: "/sessions/hello",
        kind: "read",
        command: "hello",
        resDataSchema: pingSchema,
      }),
    );
    expect(err.code).toBe("REGISTRY_SPEC_MISMATCH");
  });

  it("resData がスキーマと一致しない応答は REGISTRY_SPEC_MISMATCH", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: { code: 1000, message: "OK" },
          resData: { unexpected: 1 },
          trID: { svTRID: "KQSGN-TEST-1" },
        }),
        { status: 200 },
      ),
    );
    const err = await commandError(
      client().command({
        method: "GET",
        path: "/sessions/hello",
        kind: "read",
        command: "hello",
        resDataSchema: pingSchema,
      }),
    );
    expect(err.code).toBe("REGISTRY_SPEC_MISMATCH");
  });

  it("成功時は resData をスキーマ検証済みの値として返す", async () => {
    const { resData, envelope } = await client().command({
      method: "GET",
      path: "/sessions/hello",
      kind: "read",
      command: "hello",
      resDataSchema: pingSchema,
    });
    expect(resData.ping).toBe("pong");
    expect(envelope.result.code).toBe(1000);
  });
});
