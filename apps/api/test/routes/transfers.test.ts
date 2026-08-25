import { createRegistrySet, MockRegistryAdapter } from "@dopamin/registry";
import { type ApiErrorBody, apiErrorBodySchema } from "@dopamin/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../src/index";
import { setRegistrySetForTesting } from "../../src/lib/registries";
import { TimeoutMockAdapter } from "../helpers/timeout-mock";

/** FR-12（移管 IN / 状態照会）の Hono ルート統合テスト。 */

interface TransferPayload {
  transfer: {
    name: string;
    status: string;
    gainingRegistrar: string | null;
    losingRegistrar: string | null;
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
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  setRegistrySetForTesting(null);
  vi.restoreAllMocks();
});

async function api(path: string, init?: RequestInit): Promise<Response> {
  return app.request(`/api/v1${path}`, init);
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
  const res = await api(`/domains/${name}/auth-code`);
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
    expect(transfer).toMatchObject({ name: "move.com", status: "pending" });

    // 状態照会（transferQuery）と info のステータスにも反映される
    const query = await api("/transfers/move.com");
    expect(query.status).toBe(200);
    const queried = (await query.json()) as TransferPayload;
    expect(queried.transfer.status).toBe("pending");
    expect(queried.transfer.gainingRegistrar).not.toBeNull();

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
    expect(transfer).toMatchObject({ status: "none", gainingRegistrar: null });
  });

  it("不正なドメイン名は 400 VALIDATION_ERROR", async () => {
    const res = await api("/transfers/-bad.com");
    expect(res.status).toBe(400);
    expect((await parseError(res)).error.code).toBe("VALIDATION_ERROR");
  });
});
