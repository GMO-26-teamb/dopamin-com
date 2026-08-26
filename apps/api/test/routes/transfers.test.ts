import { createRegistrySet, MockRegistryAdapter } from "@dopamin/registry";
import {
  type ApiErrorBody,
  apiErrorBodySchema,
  type ClientStatus,
  type TransferSummary,
  type TransfersListResponse,
  transfersListResponseSchema,
} from "@dopamin/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../src/index";
import { setRegistrySetForTesting } from "../../src/lib/registries";
import {
  createInMemoryDomainStore,
  type DomainStore,
  setDomainStoreForTesting,
} from "../../src/services/domain-store";
import {
  createInMemoryTransferStore,
  setTransferStoreForTesting,
  type TransferStore,
} from "../../src/services/transfer-store";
import {
  clearTestSession,
  installTestSession,
  OTHER_USER,
  SESSION_COOKIE_HEADER,
} from "../helpers/session";
import { TimeoutMockAdapter } from "../helpers/timeout-mock";

/** FR-12（移管 IN / 一覧 / 状態照会）の Hono ルート統合テスト。 */

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
  /** `transfers` に永続化した行の要約（#56 で追加）。 */
  record: TransferSummary;
}

/** 移管 IN のシード（`seedForeignDomain`）を呼ぶために実体を持っておく。 */
let kitaqsign: MockRegistryAdapter;
let transferStore: TransferStore;
let domainStore: DomainStore;

beforeEach(() => {
  kitaqsign = new MockRegistryAdapter({ id: "kitaqsign" });
  setRegistrySetForTesting(
    createRegistrySet({
      mode: "real",
      adapters: [kitaqsign, new MockRegistryAdapter({ id: "kitaqnic" })],
    }),
  );
  domainStore = createInMemoryDomainStore();
  setDomainStoreForTesting(domainStore);
  transferStore = createInMemoryTransferStore();
  setTransferStoreForTesting(transferStore);
  installTestSession();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  setRegistrySetForTesting(null);
  setDomainStoreForTesting(null);
  setTransferStoreForTesting(null);
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

/**
 * 移管 IN の前提を作る: **相手レジストラ保有**のドメインを投入し、AuthCode を返す。
 * 自レジストラ保有のドメインには移管申請できない（§11.1 mock / FR-12）ので、
 * IN 側のシナリオはすべてここから始める。
 */
function seedForeignDomain(
  name: string,
  options?: { clientStatuses?: readonly ClientStatus[] },
): string {
  const authCode = `foreign-auth-${name}`;
  kitaqsign.seedForeignDomain(name, authCode, options);
  return authCode;
}

/** `GET /transfers` を叩いてスキーマ検証済みの一覧を返す。 */
async function listTransfers(): Promise<TransfersListResponse> {
  const res = await api("/transfers");
  expect(res.status).toBe(200);
  return transfersListResponseSchema.parse(await res.json());
}

/** 保有ドメイン一覧（FR-02）の名前だけを取り出す。 */
async function listDomainNames(): Promise<string[]> {
  const res = await api("/domains");
  expect(res.status).toBe(200);
  const { domains } = (await res.json()) as { domains: { name: string }[] };
  return domains.map((d) => d.name);
}

/** 自分が保有するドメインを登録し、移管 OUT 用の現在の AuthCode を返す。 */
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
    const authCode = seedForeignDomain("move.com");

    const res = await sendJson("/transfers", { name: "move.com", authCode });
    expect(res.status).toBe(202);
    const { transfer } = (await res.json()) as TransferPayload;
    // 申請したのは自レジストラなので requesting = 自分、対応するのは相手レジストラ（ADR-0002 決定 3）
    expect(transfer).toMatchObject({
      name: "move.com",
      status: "pending",
      requestingRegistrarId: "MOCK-REGISTRAR",
      actingRegistrarId: "MOCK-FOREIGN",
    });
    // 自動承認の期限は申請から 20 分後（FR-12）
    expect(
      new Date(String(transfer.actByAt)).getTime() -
        new Date(String(transfer.requestedAt)).getTime(),
    ).toBe(20 * 60 * 1000);

    // 受理した申請は transfers に永続化され、一覧の inbound に pending として出る
    const list = await listTransfers();
    expect(list.inbound).toHaveLength(1);
    expect(list.inbound[0]).toMatchObject({
      domainName: "move.com",
      registry: "kitaqsign",
      direction: "in",
      status: "pending",
      counterpartRegistrarId: "MOCK-FOREIGN",
      // レジストリの申請日時・自動承認期限をそのまま持つ（§9.1）
      requestedAt: transfer.requestedAt,
      actByAt: transfer.actByAt,
      completedAt: null,
      // 取り込み前なので domains 行はまだ無い
      domainId: null,
    });
    expect(list.outbound).toEqual([]);
    expect(list.history).toEqual([]);

    // レジストリ側も pendingTransfer になっている。ただし `domains` 行はこの時点では
    // 作らないので（FR-12 / 保有一覧に出さない）、保有一覧にも詳細にも出ない
    expect((await kitaqsign.info("move.com")).statuses).toContain(
      "pendingTransfer",
    );
    expect((await api("/domains/move.com")).status).toBe(404);
    expect(await listDomainNames()).toEqual([]);
  });

  it("AC-12-2: 誤った AuthCode は 422 REGISTRY_REJECTED に変換される", async () => {
    seedForeignDomain("wrong.com");
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
    // ロックを掛けているのは現スポンサー（相手レジストラ）側
    const authCode = seedForeignDomain("lock.com", {
      clientStatuses: ["clientTransferProhibited"],
    });
    const res = await sendJson("/transfers", { name: "lock.com", authCode });
    expect(res.status).toBe(409);
    expect((await parseError(res)).error.code).toBe("OPERATION_NOT_ALLOWED");
  });

  it("自レジストラ保有のドメインへの申請は 409 OPERATION_NOT_ALLOWED", async () => {
    // 自分がスポンサーのドメインに移管申請しても移管にならない（【要確認: §21.2 #15】）
    const authCode = await createDomainWithAuthCode("mine.com");
    const res = await sendJson("/transfers", { name: "mine.com", authCode });
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
    const authCode = "foreign-auth-slowmove.com";
    adapter.seedForeignDomain("slowmove.com", authCode);

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
    const authCode = "foreign-auth-lostmove.com";
    adapter.seedForeignDomain("lostmove.com", authCode);

    adapter.timeoutMode = "before-reach";
    const res = await sendJson("/transfers", {
      name: "lostmove.com",
      authCode,
    });
    expect(res.status).toBe(504);
    expect((await parseError(res)).error.code).toBe("REGISTRY_TIMEOUT");
  });
});

describe("GET /api/v1/transfers（FR-12 移管一覧）", () => {
  it("移管が 1 件も無ければ 3 区画とも空", async () => {
    expect(await listTransfers()).toEqual({
      inbound: [],
      outbound: [],
      history: [],
    });
  });

  it("AC-12-3: 相手承認後に一覧を開くとドメインが取り込まれ保有一覧に出る", async () => {
    const authCode = seedForeignDomain("gain.com");
    expect(
      (await sendJson("/transfers", { name: "gain.com", authCode })).status,
    ).toBe(202);

    // 相手レジストラが承認（移管 IN 完了）
    kitaqsign.simulateCounterpartApprove("gain.com");

    const list = await listTransfers();
    expect(list.inbound).toEqual([]);
    expect(list.history).toHaveLength(1);
    const settled = list.history[0];
    expect(settled).toMatchObject({
      domainName: "gain.com",
      direction: "in",
      status: "approved",
    });
    // 取り込みで domains 行が作られ、domain_id が紐付く（§6.5）
    expect(settled?.domainId).not.toBeNull();
    expect(settled?.completedAt).not.toBeNull();
    expect(await listDomainNames()).toEqual(["gain.com"]);
  });

  it("相手が拒否した場合は Poll 消化（#58）まで pending のまま残る", async () => {
    const authCode = seedForeignDomain("nope.com");
    expect(
      (await sendJson("/transfers", { name: "nope.com", authCode })).status,
    ).toBe(202);
    kitaqsign.simulateCounterpartReject("nope.com");

    // transferQuery は info の pendingTransfer からの導出なので拒否と取消を区別できない
    const list = await listTransfers();
    expect(list.inbound).toHaveLength(1);
    expect(list.inbound[0]?.status).toBe("pending");
    expect(await listDomainNames()).toEqual([]);
  });

  it("NFR-04: 死んだ pending 行が他ユーザーの保有ドメインを奪わない", async () => {
    // 1. 自分が申請 → 相手が拒否。Poll 消化（#58）が入るまで行は pending のまま残る
    const authCode = seedForeignDomain("steal.com");
    expect(
      (await sendJson("/transfers", { name: "steal.com", authCode })).status,
    ).toBe(202);
    kitaqsign.simulateCounterpartReject("steal.com");
    expect((await listTransfers()).inbound).toHaveLength(1);

    // 2. その後、同じドメインが別ユーザーのものとして正規に移管 IN される
    //    （trDate が自分の申請の窓の内側で動くので、trDate だけでは区別が付かない）
    await kitaqsign.transferRequest("steal.com", authCode);
    kitaqsign.simulateCounterpartApprove("steal.com");
    await domainStore.upsert({
      userId: OTHER_USER.id,
      name: "steal.com",
      registry: "kitaqsign",
      ownership: "owned",
      info: await kitaqsign.info("steal.com"),
      syncedAt: new Date(),
    });

    // 3. 自分が一覧を開き直しても、他ユーザーの保有行は奪われない
    const list = await listTransfers();
    expect(list.history).toEqual([]);
    expect(list.inbound).toHaveLength(1);
    expect(await listDomainNames()).toEqual([]);
    expect((await domainStore.find("steal.com"))?.userId).toBe(OTHER_USER.id);
  });

  it("他ユーザーの移管行は一覧に出ない（NFR-04）", async () => {
    await transferStore.create({
      userId: OTHER_USER.id,
      domainId: null,
      domainName: "other.com",
      registry: "kitaqsign",
      direction: "in",
      status: "approved",
      registryStatus: null,
      counterpartRegistrarId: null,
      registryMessageId: null,
      requestedAt: new Date(),
      actByAt: null,
      completedAt: new Date(),
      raw: null,
    });
    expect(await listTransfers()).toEqual({
      inbound: [],
      outbound: [],
      history: [],
    });
  });
});

describe("GET /api/v1/transfers/:id（FR-12 状態照会）", () => {
  it("申請直後は pending のまま返る", async () => {
    const authCode = seedForeignDomain("one.com");
    const created = await sendJson("/transfers", {
      name: "one.com",
      authCode,
    });
    const { record } = (await created.json()) as TransferPayload;

    const res = await api(`/transfers/${record.id}`);
    expect(res.status).toBe(200);
    const { transfer } = (await res.json()) as { transfer: TransferSummary };
    expect(transfer).toMatchObject({
      id: record.id,
      domainName: "one.com",
      direction: "in",
      status: "pending",
    });
  });

  it("AC-12-3: 承認済みなら照会時に取り込まれる", async () => {
    const authCode = seedForeignDomain("two.com");
    const created = await sendJson("/transfers", {
      name: "two.com",
      authCode,
    });
    const { record } = (await created.json()) as TransferPayload;
    kitaqsign.simulateCounterpartApprove("two.com");

    const res = await api(`/transfers/${record.id}`);
    const { transfer } = (await res.json()) as { transfer: TransferSummary };
    expect(transfer.status).toBe("approved");
    expect(transfer.domainId).not.toBeNull();
    expect(await listDomainNames()).toEqual(["two.com"]);
  });

  it("FR-18: レジストリの生応答（raw）はクライアントに返さない", async () => {
    const authCode = seedForeignDomain("noraw.com");
    const created = await sendJson("/transfers", {
      name: "noraw.com",
      authCode,
    });
    expect(created.status).toBe(202);
    const body = (await created.json()) as TransferPayload;
    expect(body).toMatchObject({
      transfer: expect.not.objectContaining({ raw: expect.anything() }),
      record: expect.not.objectContaining({ raw: expect.anything() }),
    });

    const res = await api(`/transfers/${body.record.id}`);
    expect(await res.json()).toMatchObject({
      transfer: expect.not.objectContaining({ raw: expect.anything() }),
    });
  });

  it("uuid でない ID（旧パスのドメイン名を含む）は 400 VALIDATION_ERROR", async () => {
    const res = await api("/transfers/idle.com");
    expect(res.status).toBe(400);
    expect((await parseError(res)).error.code).toBe("VALIDATION_ERROR");
  });

  it("存在しない ID は 404 NOT_FOUND", async () => {
    const res = await api("/transfers/00000000-0000-4000-8000-00000000dead");
    expect(res.status).toBe(404);
    expect((await parseError(res)).error.code).toBe("NOT_FOUND");
  });

  it("他ユーザーの移管行は 403 FORBIDDEN（§10.3）", async () => {
    const other = await transferStore.create({
      userId: OTHER_USER.id,
      domainId: null,
      domainName: "other.com",
      registry: "kitaqsign",
      direction: "in",
      status: "pending",
      registryStatus: null,
      counterpartRegistrarId: null,
      registryMessageId: null,
      requestedAt: new Date(),
      actByAt: null,
      completedAt: null,
      raw: null,
    });
    const res = await api(`/transfers/${other.id}`);
    expect(res.status).toBe(403);
    expect((await parseError(res)).error.code).toBe("FORBIDDEN");
  });
});

describe("AC-01-3: 移管ルートの認証", () => {
  it.each([
    ["POST", "/api/v1/transfers"],
    ["GET", "/api/v1/transfers"],
    ["GET", "/api/v1/transfers/00000000-0000-4000-8000-000000000001"],
  ])("%s %s は Cookie 無しで 401 UNAUTHORIZED", async (method, path) => {
    const res = await app.request(path, { method });
    expect(res.status).toBe(401);
    expect((await parseError(res)).error.code).toBe("UNAUTHORIZED");
  });
});
