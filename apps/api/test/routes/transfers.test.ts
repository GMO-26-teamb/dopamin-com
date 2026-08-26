import { createRegistrySet, MockRegistryAdapter } from "@dopamin/registry";
import { type ApiErrorBody, apiErrorBodySchema } from "@dopamin/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../src/index";
import { setRegistrySetForTesting } from "../../src/lib/registries";
import {
  createInMemoryDomainStore,
  setDomainStoreForTesting,
} from "../../src/services/domain-store";
import {
  clearTestSession,
  installTestSession,
  SESSION_COOKIE_HEADER,
} from "../helpers/session";
import { TimeoutMockAdapter } from "../helpers/timeout-mock";

/** FR-12（移管 IN / 状態照会）の Hono ルート統合テスト。 */

/** 応答は正規化 `TransferResult` から `raw` を除いた DTO（ADR-0002）。 */
interface TransferPayload {
  transfer: {
    name: string;
    status: string;
    registryStatus?: string;
    requestingRegistrarId?: string;
    actingRegistrarId?: string;
    requestedAt?: string;
    actByAt?: string;
  };
}

beforeEach(() => {
  setRegistrySetForTesting(
    createRegistrySet({
      mode: "real",
      adapters: [
        new MockRegistryAdapter({ id: "kitaqsign" }),
        new MockRegistryAdapter({ id: "kitaqnic" }),
      ],
    }),
  );
  setDomainStoreForTesting(createInMemoryDomainStore());
  installTestSession();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  setRegistrySetForTesting(null);
  setDomainStoreForTesting(null);
  clearTestSession();
  vi.restoreAllMocks();
});

/** 認証済みリクエスト（移管操作も認証必須。AC-01-3）。 */
async function api(path: string, init?: RequestInit): Promise<Response> {
  return app.request(`/api/v1${path}`, {
    ...init,
    headers: { cookie: SESSION_COOKIE_HEADER, ...init?.headers },
  });
}

function sendJson(
  path: string,
  body: unknown,
  method = "POST",
): Promise<Response> {
  return api(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function parseError(res: Response): Promise<ApiErrorBody> {
  return apiErrorBodySchema.parse(await res.json());
}

/** ドメインを登録し、移管に使える現在の AuthCode を返す。 */
async function createDomainWithAuthCode(name: string): Promise<string> {
  const created = await sendJson("/domains", { name, period: 1 });
  expect(created.status).toBe(201);
  const res = await api(`/domains/${name}/auth-code`, { method: "POST" });
  expect(res.status).toBe(200);
  const { authCode } = (await res.json()) as { authCode: string };
  return authCode;
}

describe("POST /api/v1/transfers（FR-12 移管 IN）", () => {
  it("AC-12-1: 正しい AuthCode で申請が受理され pendingTransfer になる", async () => {
    const authCode = await createDomainWithAuthCode("move.com");

    const res = await sendJson("/transfers", { name: "move.com", authCode });
    expect(res.status).toBe(202);
    const { transfer } = (await res.json()) as TransferPayload;
    expect(transfer).toMatchObject({
      name: "move.com",
      status: "pending",
      requestingRegistrarId: "MOCK-GAINING",
      actingRegistrarId: "MOCK-LOSING",
    });
    // 自動承認の期限は申請から 20 分後（FR-12）
    expect(
      new Date(String(transfer.actByAt)).getTime() -
        new Date(String(transfer.requestedAt)).getTime(),
    ).toBe(20 * 60 * 1000);

    // 状態照会（transferQuery）と info のステータスにも反映される
    const query = await api("/transfers/move.com");
    expect(query.status).toBe(200);
    const queried = (await query.json()) as TransferPayload;
    expect(queried.transfer.status).toBe("pending");
    expect(queried.transfer.requestingRegistrarId).toBe("MOCK-GAINING");

    const info = await api("/domains/move.com");
    const { domain } = (await info.json()) as {
      domain: { statuses: string[] };
    };
    expect(domain.statuses).toContain("pendingTransfer");
  });

  it("AC-12-2: 誤った AuthCode は 422 REGISTRY_REJECTED に変換される", async () => {
    await createDomainWithAuthCode("wrong.com");
    const res = await sendJson("/transfers", {
      name: "wrong.com",
      authCode: "wrong-auth-code",
    });
    expect(res.status).toBe(422);
    const text = await res.text();
    const body = apiErrorBodySchema.parse(JSON.parse(text));
    expect(body.error).toMatchObject({
      code: "REGISTRY_REJECTED",
      registry: "kitaqsign",
      registryCode: "2202",
      retryable: false,
    });
    // レジストリの生メッセージはユーザー向けメッセージに置き換える（FR-18）
    expect(text).not.toContain("一致しません");
  });

  it("clientTransferProhibited 中の申請は 409 OPERATION_NOT_ALLOWED", async () => {
    const authCode = await createDomainWithAuthCode("lock.com");
    await sendJson(
      "/domains/lock.com",
      { clientStatuses: { add: ["clientTransferProhibited"] } },
      "PATCH",
    );
    const res = await sendJson("/transfers", { name: "lock.com", authCode });
    expect(res.status).toBe(409);
    expect((await parseError(res)).error.code).toBe("OPERATION_NOT_ALLOWED");
  });

  it("未登録ドメインへの申請は 404 NOT_FOUND", async () => {
    const res = await sendJson("/transfers", {
      name: "ghost.com",
      authCode: "whatever",
    });
    expect(res.status).toBe(404);
    expect((await parseError(res)).error.code).toBe("NOT_FOUND");
  });

  it("authCode が空なら 400 VALIDATION_ERROR", async () => {
    const res = await sendJson("/transfers", { name: "a.com", authCode: "" });
    expect(res.status).toBe(400);
    expect((await parseError(res)).error.code).toBe("VALIDATION_ERROR");
  });
});

describe("AC-18-2: 移管申請タイムアウト時の info 照合", () => {
  it("申請がレジストリに到達していれば、応答タイムアウトでも 202 を返す", async () => {
    const adapter = new TimeoutMockAdapter("kitaqsign");
    setRegistrySetForTesting(
      createRegistrySet({ mode: "real", adapters: [adapter] }),
    );
    const authCode = await createDomainWithAuthCode("slowmove.com");

    adapter.timeoutMode = "after-success";
    const res = await sendJson("/transfers", {
      name: "slowmove.com",
      authCode,
    });
    expect(res.status).toBe(202);
    const { transfer } = (await res.json()) as TransferPayload;
    expect(transfer.status).toBe("pending");
  });

  it("申請が届いていなければ 504 REGISTRY_TIMEOUT のまま", async () => {
    const adapter = new TimeoutMockAdapter("kitaqsign");
    setRegistrySetForTesting(
      createRegistrySet({ mode: "real", adapters: [adapter] }),
    );
    const authCode = await createDomainWithAuthCode("lostmove.com");

    adapter.timeoutMode = "before-reach";
    const res = await sendJson("/transfers", {
      name: "lostmove.com",
      authCode,
    });
    expect(res.status).toBe(504);
    expect((await parseError(res)).error.code).toBe("REGISTRY_TIMEOUT");
  });
});

describe("GET /api/v1/transfers/:name（FR-12 状態照会）", () => {
  it("移管中でないドメインは status none を返す", async () => {
    await createDomainWithAuthCode("idle.com");
    const res = await api("/transfers/idle.com");
    expect(res.status).toBe(200);
    const { transfer } = (await res.json()) as TransferPayload;
    expect(transfer).toMatchObject({ status: "none" });
    // 移管中でなければ相手レジストラは分からない（info から導出しているため）
    expect(transfer.requestingRegistrarId).toBeUndefined();
    expect(transfer.actingRegistrarId).toBeUndefined();
  });

  it("FR-18: レジストリの生応答（raw）はクライアントに返さない", async () => {
    const authCode = await createDomainWithAuthCode("noraw.com");
    const created = await sendJson("/transfers", {
      name: "noraw.com",
      authCode,
    });
    expect(created.status).toBe(202);
    expect(await created.json()).toMatchObject({
      transfer: expect.not.objectContaining({ raw: expect.anything() }),
    });

    const res = await api("/transfers/noraw.com");
    expect(await res.json()).toMatchObject({
      transfer: expect.not.objectContaining({ raw: expect.anything() }),
    });
  });

  it("不正なドメイン名は 400 VALIDATION_ERROR", async () => {
    const res = await api("/transfers/-bad.com");
    expect(res.status).toBe(400);
    expect((await parseError(res)).error.code).toBe("VALIDATION_ERROR");
  });
});

describe("AC-01-3: 移管ルートの認証", () => {
  it.each([
    ["POST", "/api/v1/transfers"],
    ["GET", "/api/v1/transfers/move.com"],
  ])("%s %s は Cookie 無しで 401 UNAUTHORIZED", async (method, path) => {
    const res = await app.request(path, { method });
    expect(res.status).toBe(401);
    expect((await parseError(res)).error.code).toBe("UNAUTHORIZED");
  });
});
