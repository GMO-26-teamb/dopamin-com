import { createRegistrySet, MockRegistryAdapter } from "@dopamin/registry";
import {
  type ApiError,
  apiErrorSchema,
  type ClientStatus,
  pollConsumeResultSchema,
  type TransferSummary,
  type TransfersListResponse,
  transfersListResponseSchema,
} from "@dopamin/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../src/index";
import { setRegistrySetForTesting } from "../../src/lib/registries";
import { setRetrySleepForTesting } from "../../src/lib/retry";
import {
  createInMemoryContactStore,
  setContactStoreForTesting,
} from "../../src/services/contact.service";
import {
  createInMemoryDomainStore,
  type DomainStore,
  setDomainStoreForTesting,
} from "../../src/services/domain-store";
import { recordOutboundTransferRequest } from "../../src/services/transfer.service";
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
  TEST_USER,
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
  // 参照系の自動再試行（#60）のバックオフでテストが待たされないようにする
  setRetrySleepForTesting(() => Promise.resolve());

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
  // 登録・情報修正はユーザー × レジストリのコンタクトを引く（#72）
  setContactStoreForTesting(createInMemoryContactStore());
  installTestSession();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  setRetrySleepForTesting(null);

  setRegistrySetForTesting(null);
  setDomainStoreForTesting(null);
  setTransferStoreForTesting(null);
  setContactStoreForTesting(null);
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

async function parseError(res: Response): Promise<ApiError> {
  return apiErrorSchema.parse(await res.json());
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

/**
 * 移管 OUT の前提を作る（AC-12-4）: 自分の保有ドメインに相手レジストラからの申請を
 * 受信させ、Poll を消化して `transfers(direction = out, status = pending)` を作る。
 * 本番と同じ経路（Poll 通知 → `transfers` 行）を通す。
 */
async function receiveOutboundRequest(name: string): Promise<string> {
  await sendJson("/domains", { name, period: 1 });
  kitaqsign.simulateInboundTransferRequest(name);

  const res = await api("/registry/poll", { method: "POST" });
  expect(res.status).toBe(200);
  expect(pollConsumeResultSchema.parse(await res.json())).toMatchObject({
    created: 1,
    failures: [],
  });

  const row = await transferStore.findPending(name, "out");
  if (!row) {
    throw new Error(`Poll 消化後に ${name} の OUT 行が作られていない`);
  }
  return row.id;
}

describe("POST /api/v1/transfers（FR-12 移管 IN）", () => {
  it("NFR-04: 他ユーザーが保有中のドメインへの移管 IN 申請は 403 FORBIDDEN", async () => {
    // 同一レジストラ内の所有者変更は EPP 移管にならない（§2.2）ので、
    // 他ユーザーの保有行に対する申請はレジストリに送る前に弾く
    const authCode = await createDomainWithAuthCode("theirs.com");
    const owned = await domainStore.find("theirs.com");
    if (!owned) {
      throw new Error("theirs.com の保有行がありません");
    }
    await domainStore.upsert({ ...owned, userId: OTHER_USER.id });

    const res = await sendJson("/transfers", { name: "theirs.com", authCode });
    expect(res.status).toBe(403);
    expect((await parseError(res)).error.code).toBe("FORBIDDEN");
    // レジストリに申請を送っていないので、移管中にもなっていない
    expect(await transferStore.findPending("theirs.com", "in")).toBeNull();
  });

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
    const body = apiErrorSchema.parse(JSON.parse(text));
    expect(body.error).toMatchObject({
      code: "REGISTRY_REJECTED",
      registry: "kitaqsign",
      registryCode: "2202",
      retryable: false,
    });
    // AC-12-2: 2202 は原因が特定できるので「AuthCode が違う」と伝える（#47）
    expect(body.error.message).toBe("AuthCode が正しくありません。");
    // FR-18: レジストリの生メッセージそのものは出さない
    // （mock は `transfer:request: AuthCode が一致しません` を返す）
    expect(text).not.toContain("transfer:request");
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

  it("AC-12-2: 相手が拒否すると Poll 消化で rejected として履歴に残る", async () => {
    const authCode = seedForeignDomain("nope.com");
    expect(
      (await sendJson("/transfers", { name: "nope.com", authCode })).status,
    ).toBe(202);
    kitaqsign.simulateCounterpartReject("nope.com");

    // transferQuery（info の pendingTransfer 導出）では拒否と取消を区別できない。
    // 区別できるのは Poll だけで、一覧の表示時に消化する（§10.1）
    const list = await listTransfers();
    expect(list.inbound).toEqual([]);
    expect(list.history).toHaveLength(1);
    expect(list.history[0]).toMatchObject({
      domainName: "nope.com",
      direction: "in",
      status: "rejected",
    });
    // 拒否なのでドメインは取り込まれない
    expect(await listDomainNames()).toEqual([]);
    expect(list.history[0]?.domainId).toBeNull();
  });

  it("NFR-04: 取り残された pending 行が他ユーザーの保有ドメインを奪わない", async () => {
    // 自分の申請が確定しないまま残っている状態（通知の取りこぼし・レジストリ障害など）。
    // 行を直接置いて「Poll でも transferQuery でも決着していない pending」を作る
    const authCode = seedForeignDomain("steal.com");
    const requestedAt = new Date();
    await transferStore.create({
      userId: TEST_USER.id,
      domainId: null,
      domainName: "steal.com",
      registry: "kitaqsign",
      direction: "in",
      status: "pending",
      registryStatus: "pending",
      counterpartRegistrarId: "MOCK-FOREIGN",
      registryMessageId: null,
      requestedAt,
      actByAt: new Date(requestedAt.getTime() + 20 * 60 * 1000),
      completedAt: null,
      raw: null,
    });

    // その後、同じドメインが別ユーザーのものとして正規に移管 IN される。
    // trDate は自分の申請の窓の内側で動くので、trDate だけでは自分の申請と区別が付かない
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

    // 一覧を開き直しても、他ユーザーの保有行は奪われない
    await listTransfers();
    expect(await listDomainNames()).toEqual([]);
    const domain = await domainStore.find("steal.com");
    expect(domain?.userId).toBe(OTHER_USER.id);
    expect(domain?.ownership).toBe("owned");
    // 取り込みは見送られるので domain_id は紐付かない
    const rows = await transferStore.list(TEST_USER.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.domainId).toBeNull();
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

describe("POST /api/v1/transfers/:id/approve・reject（FR-12 移管 OUT）", () => {
  it("AC-12-4 / AC-12-5: 承認すると保有一覧から消え、履歴に approved で残る", async () => {
    const id = await receiveOutboundRequest("leave.com");

    // 承認前は「受信した申請」として outbound に出る
    const before = await listTransfers();
    expect(before.outbound).toHaveLength(1);
    expect(before.outbound[0]).toMatchObject({
      domainName: "leave.com",
      direction: "out",
      status: "pending",
      counterpartRegistrarId: "MOCK-FOREIGN",
    });
    expect(await listDomainNames()).toEqual(["leave.com"]);

    const res = await api(`/transfers/${id}/approve`, { method: "POST" });
    expect(res.status).toBe(200);
    const { transfer } = (await res.json()) as { transfer: TransferSummary };
    expect(transfer).toMatchObject({ id, status: "approved" });
    expect(transfer.completedAt).not.toBeNull();

    // レジストリ側でも承認されている（スポンサーが相手レジストラへ移った）。
    // mock の rotate-auth-info は現スポンサーしか実行できないので、これで承認と拒否を見分けられる
    await expect(kitaqsign.authCode("leave.com")).rejects.toMatchObject({
      code: "REGISTRY_REJECTED",
      registryCode: 2201,
    });
    expect((await kitaqsign.info("leave.com")).lastTransferAt).not.toBeNull();

    // AC-12-5: 保有一覧から消える（行は履歴として残る）
    expect(await listDomainNames()).toEqual([]);
    expect((await domainStore.find("leave.com"))?.ownership).toBe(
      "transferred_out",
    );
    const after = await listTransfers();
    expect(after.outbound).toEqual([]);
    expect(after.history).toHaveLength(1);
    expect(after.history[0]?.status).toBe("approved");
  });

  it("AC-12-5: 承認後は詳細を開いても保有一覧に復活しない", async () => {
    const id = await receiveOutboundRequest("gone.com");
    expect(
      (await api(`/transfers/${id}/approve`, { method: "POST" })).status,
    ).toBe(200);

    // 履歴からの導線で詳細を開く（移管済みのドメインも表示だけはできる）
    const detail = await api("/domains/gone.com");
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as {
      summary: { ownership: string } | null;
    };
    expect(body.summary?.ownership).toBe("transferred_out");

    // `info` の write-through で ownership = 'owned' の行が復活しないこと
    expect(await listDomainNames()).toEqual([]);
    expect((await domainStore.find("gone.com"))?.ownership).toBe(
      "transferred_out",
    );
  });

  it("AC-12-4: 拒否すると保有は動かず、履歴に rejected で残る", async () => {
    const id = await receiveOutboundRequest("stay.com");

    const res = await api(`/transfers/${id}/reject`, { method: "POST" });
    expect(res.status).toBe(200);
    const { transfer } = (await res.json()) as { transfer: TransferSummary };
    expect(transfer).toMatchObject({ id, status: "rejected" });

    // レジストリ側でも申請だけが消え、スポンサーは自分のまま
    // （承認していれば rotate-auth-info が 2201 で失敗する）
    await expect(kitaqsign.authCode("stay.com")).resolves.toBeTruthy();
    expect((await kitaqsign.info("stay.com")).statuses).not.toContain(
      "pendingTransfer",
    );
    expect((await kitaqsign.info("stay.com")).lastTransferAt).toBeNull();

    // 拒否は申請を取り下げるだけ。ドメインは保有したまま
    expect(await listDomainNames()).toEqual(["stay.com"]);
    expect((await domainStore.find("stay.com"))?.ownership).toBe("owned");
    const after = await listTransfers();
    expect(after.outbound).toEqual([]);
    expect(after.history[0]?.status).toBe("rejected");
  });

  it("AC-12-5: 移管 OUT 済みのドメインは再び承認できない", async () => {
    const id = await receiveOutboundRequest("once.com");
    expect(
      (await api(`/transfers/${id}/approve`, { method: "POST" })).status,
    ).toBe(200);

    const res = await api(`/transfers/${id}/approve`, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await parseError(res)).error.code).toBe("OPERATION_NOT_ALLOWED");
  });

  it("確定済み（拒否済み）の行は承認できない（status = pending が前提）", async () => {
    const id = await receiveOutboundRequest("settled.com");
    expect(
      (await api(`/transfers/${id}/reject`, { method: "POST" })).status,
    ).toBe(200);

    const res = await api(`/transfers/${id}/approve`, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await parseError(res)).error.details).toMatchObject({
      reason: "not_pending",
    });
    // 保有は動かない（拒否の結果がひっくり返らない）
    expect(await listDomainNames()).toEqual(["settled.com"]);
  });

  it("自分が保有していないドメインの OUT 行は承認できない（NFR-04）", async () => {
    // 保有行を他ユーザーに付け替えた状態（Poll 由来の行が古くなった等）を作る
    await sendJson("/domains", { name: "notyours.com", period: 1 });
    const result = kitaqsign.simulateInboundTransferRequest("notyours.com");
    const record = await recordOutboundTransferRequest(
      TEST_USER.id,
      kitaqsign,
      result,
    );
    const existing = await domainStore.find("notyours.com");
    if (!existing) {
      throw new Error("保有行が見つからない");
    }
    await domainStore.upsert({ ...existing, userId: OTHER_USER.id });

    const res = await api(`/transfers/${record.id}/approve`, {
      method: "POST",
    });
    expect(res.status).toBe(409);
    expect((await parseError(res)).error.details).toMatchObject({
      reason: "not_owned",
    });
    // 他ユーザーの保有行は倒れていない
    expect((await domainStore.find("notyours.com"))?.ownership).toBe("owned");
  });

  it("移管 IN の行は承認・拒否できない（向き違いは 409）", async () => {
    const authCode = seedForeignDomain("wrongway.com");
    const created = await sendJson("/transfers", {
      name: "wrongway.com",
      authCode,
    });
    const { record } = (await created.json()) as TransferPayload;

    for (const action of ["approve", "reject"]) {
      const res = await api(`/transfers/${record.id}/${action}`, {
        method: "POST",
      });
      expect(res.status).toBe(409);
      expect((await parseError(res)).error.code).toBe("OPERATION_NOT_ALLOWED");
    }
    // レジストリ側の申請はそのまま残っている
    expect((await kitaqsign.info("wrongway.com")).statuses).toContain(
      "pendingTransfer",
    );
  });

  it("他ユーザーの移管行は 403 FORBIDDEN", async () => {
    const other = await transferStore.create({
      userId: OTHER_USER.id,
      domainId: null,
      domainName: "other.com",
      registry: "kitaqsign",
      direction: "out",
      status: "pending",
      registryStatus: null,
      counterpartRegistrarId: null,
      registryMessageId: null,
      requestedAt: new Date(),
      actByAt: null,
      completedAt: null,
      raw: null,
    });
    const res = await api(`/transfers/${other.id}/approve`, { method: "POST" });
    expect(res.status).toBe(403);
    expect((await parseError(res)).error.code).toBe("FORBIDDEN");
  });
});

describe("移管バッジ（§10.4 `transfer`。FR-12 / AC-07-3）", () => {
  it("受信中の移管がある保有ドメインは一覧・詳細に out のバッジが付く", async () => {
    const id = await receiveOutboundRequest("badge.com");
    const pending = await transferStore.findById(id);

    const list = await api("/domains");
    const { domains } = (await list.json()) as {
      domains: { name: string; transfer: unknown }[];
    };
    expect(domains[0]).toMatchObject({
      name: "badge.com",
      transfer: {
        direction: "out",
        actByAt: pending?.actByAt?.toISOString(),
      },
    });

    const detail = await api("/domains/badge.com");
    const body = (await detail.json()) as { summary: { transfer: unknown } };
    expect(body.summary.transfer).toMatchObject({ direction: "out" });
  });

  it("移管が確定するとバッジは消える", async () => {
    const id = await receiveOutboundRequest("badge-done.com");
    expect(
      (await api(`/transfers/${id}/reject`, { method: "POST" })).status,
    ).toBe(200);

    const list = await api("/domains");
    const { domains } = (await list.json()) as {
      domains: { name: string; transfer: unknown }[];
    };
    expect(domains[0]).toMatchObject({
      name: "badge-done.com",
      transfer: null,
    });
  });

  it("移管中でないドメインのバッジは null", async () => {
    await createDomainWithAuthCode("plain.com");
    const list = await api("/domains");
    const { domains } = (await list.json()) as {
      domains: { transfer: unknown }[];
    };
    expect(domains[0]?.transfer).toBeNull();
  });
});

describe("recordOutboundTransferRequest（受信申請の記録。#58 の Poll 消化が使う）", () => {
  it("domains 行の ID を紐付け、outbound に pending として出る", async () => {
    await sendJson("/domains", { name: "linked.com", period: 1 });
    const domain = await domainStore.find("linked.com");
    const result = kitaqsign.simulateInboundTransferRequest("linked.com");

    const record = await recordOutboundTransferRequest(
      TEST_USER.id,
      kitaqsign,
      result,
      { domainId: domain?.id ?? null, registryMessageId: "42" },
    );
    expect(record).toMatchObject({
      domainName: "linked.com",
      direction: "out",
      status: "pending",
      domainId: domain?.id,
      registryMessageId: "42",
      counterpartRegistrarId: "MOCK-FOREIGN",
    });
    expect(record.actByAt).not.toBeNull();
  });

  it("同じ Poll メッセージ ID を二度取り込んでも行は増えない（冪等）", async () => {
    await sendJson("/domains", { name: "dup.com", period: 1 });
    const result = kitaqsign.simulateInboundTransferRequest("dup.com");

    const first = await recordOutboundTransferRequest(
      TEST_USER.id,
      kitaqsign,
      result,
      { registryMessageId: "7" },
    );
    const second = await recordOutboundTransferRequest(
      TEST_USER.id,
      kitaqsign,
      result,
      { registryMessageId: "7" },
    );
    expect(second.id).toBe(first.id);
    expect((await listTransfers()).outbound).toHaveLength(1);
  });

  it("メッセージ ID が無くても同じドメインの pending 行は増えない（info 由来の検知）", async () => {
    await sendJson("/domains", { name: "again-out.com", period: 1 });
    const result = kitaqsign.simulateInboundTransferRequest("again-out.com");

    const first = await recordOutboundTransferRequest(
      TEST_USER.id,
      kitaqsign,
      result,
    );
    const second = await recordOutboundTransferRequest(
      TEST_USER.id,
      kitaqsign,
      result,
    );
    expect(second.id).toBe(first.id);
    expect((await listTransfers()).outbound).toHaveLength(1);
  });
});

describe("POST /api/v1/transfers/:id/cancel（FR-12 移管 IN の取消）", () => {
  it("承認前の IN 申請を取り消すと cancelled になり、保有一覧にも出ない", async () => {
    const authCode = seedForeignDomain("undo.com");
    const created = await sendJson("/transfers", {
      name: "undo.com",
      authCode,
    });
    const { record } = (await created.json()) as TransferPayload;

    const res = await api(`/transfers/${record.id}/cancel`, { method: "POST" });
    expect(res.status).toBe(200);
    const { transfer } = (await res.json()) as { transfer: TransferSummary };
    expect(transfer).toMatchObject({ id: record.id, status: "cancelled" });

    // レジストリ側の申請も消えている
    expect((await kitaqsign.info("undo.com")).statuses).not.toContain(
      "pendingTransfer",
    );
    const after = await listTransfers();
    expect(after.inbound).toEqual([]);
    expect(after.history[0]?.status).toBe("cancelled");
    expect(await listDomainNames()).toEqual([]);
  });

  it("受信した OUT 申請は取り消せない（向き違いは 409）", async () => {
    const id = await receiveOutboundRequest("notmine.com");
    const res = await api(`/transfers/${id}/cancel`, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await parseError(res)).error.code).toBe("OPERATION_NOT_ALLOWED");
  });

  it("確定済みの行は取り消せない（409）", async () => {
    const authCode = seedForeignDomain("done.com");
    const created = await sendJson("/transfers", {
      name: "done.com",
      authCode,
    });
    const { record } = (await created.json()) as TransferPayload;
    expect(
      (await api(`/transfers/${record.id}/cancel`, { method: "POST" })).status,
    ).toBe(200);

    const res = await api(`/transfers/${record.id}/cancel`, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await parseError(res)).error.code).toBe("OPERATION_NOT_ALLOWED");
  });

  it("移管 OUT 済みの履歴行があっても、同名の再 IN 申請は取り消せる（出戻り）", async () => {
    // 一度 OUT した名前を後日また移管 IN する。`domains` には transferred_out の
    // 履歴行が残るが、`find` がそれを拾って取消をブロックしてはいけない
    const authCode = await createDomainWithAuthCode("again.com");
    const result = kitaqsign.simulateInboundTransferRequest("again.com");
    const out = await recordOutboundTransferRequest(
      TEST_USER.id,
      kitaqsign,
      result,
    );
    expect(
      (await api(`/transfers/${out.id}/approve`, { method: "POST" })).status,
    ).toBe(200);
    expect((await domainStore.find("again.com"))?.ownership).toBe(
      "transferred_out",
    );

    // 相手レジストラ保有になったので、同じ AuthCode で移管 IN を申請し直せる
    const created = await sendJson("/transfers", {
      name: "again.com",
      authCode,
    });
    expect(created.status).toBe(202);
    const { record } = (await created.json()) as TransferPayload;

    const res = await api(`/transfers/${record.id}/cancel`, { method: "POST" });
    expect(res.status).toBe(200);
    const { transfer } = (await res.json()) as { transfer: TransferSummary };
    expect(transfer.status).toBe("cancelled");
  });

  it("uuid でない ID は 400 VALIDATION_ERROR", async () => {
    const res = await api("/transfers/undo.com/cancel", { method: "POST" });
    expect(res.status).toBe(400);
    expect((await parseError(res)).error.code).toBe("VALIDATION_ERROR");
  });
});

describe("AC-18-2: 承認のタイムアウト時は transferQuery で照合する", () => {
  it("承認がレジストリに届いていれば、応答タイムアウトでも 200 を返す", async () => {
    const adapter = new TimeoutMockAdapter("kitaqsign");
    setRegistrySetForTesting(
      createRegistrySet({ mode: "real", adapters: [adapter] }),
    );
    await sendJson("/domains", { name: "slowapprove.com", period: 1 });
    const result = adapter.simulateInboundTransferRequest("slowapprove.com");
    const record = await recordOutboundTransferRequest(
      TEST_USER.id,
      adapter,
      result,
    );

    adapter.timeoutMode = "after-success";
    const res = await api(`/transfers/${record.id}/approve`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const { transfer } = (await res.json()) as { transfer: TransferSummary };
    expect(transfer.status).toBe("approved");
    expect(await listDomainNames()).toEqual([]);
  });

  it("承認が届いていなければ 504 REGISTRY_TIMEOUT のまま保有は動かない", async () => {
    const adapter = new TimeoutMockAdapter("kitaqsign");
    setRegistrySetForTesting(
      createRegistrySet({ mode: "real", adapters: [adapter] }),
    );
    await sendJson("/domains", { name: "lostapprove.com", period: 1 });
    const result = adapter.simulateInboundTransferRequest("lostapprove.com");
    const record = await recordOutboundTransferRequest(
      TEST_USER.id,
      adapter,
      result,
    );

    adapter.timeoutMode = "before-reach";
    const res = await api(`/transfers/${record.id}/approve`, {
      method: "POST",
    });
    expect(res.status).toBe(504);
    expect((await parseError(res)).error.code).toBe("REGISTRY_TIMEOUT");
    // 保有はそのまま（偽の成功にしない）
    expect(await listDomainNames()).toEqual(["lostapprove.com"]);
  });

  it("申請が別の理由で消えていれば、承認のタイムアウトは 504 のまま", async () => {
    // 「申請が消えた」だけでは承認の証跡にならない（ADR-0002 決定 1）。
    // 相手が取り下げただけなのに承認扱いにすると、保有しているドメインを失う
    const adapter = new TimeoutMockAdapter("kitaqsign");
    setRegistrySetForTesting(
      createRegistrySet({ mode: "real", adapters: [adapter] }),
    );
    await sendJson("/domains", { name: "vanished.com", period: 1 });
    const result = adapter.simulateInboundTransferRequest("vanished.com");
    const record = await recordOutboundTransferRequest(
      TEST_USER.id,
      adapter,
      result,
    );

    // 承認が届く前に申請が別経路で消えた（ここでは拒否で消す。trDate は動かない）
    await adapter.transferReject("vanished.com");
    adapter.timeoutMode = "before-reach";

    const res = await api(`/transfers/${record.id}/approve`, {
      method: "POST",
    });
    expect(res.status).toBe(504);
    expect((await parseError(res)).error.code).toBe("REGISTRY_TIMEOUT");
    // 保有は動かない（移管されていないため）
    expect(await listDomainNames()).toEqual(["vanished.com"]);
    expect((await domainStore.find("vanished.com"))?.ownership).toBe("owned");
  });

  it.each([
    ["reject", "rejectme.com"],
    ["cancel", "cancelme.com"],
  ])(
    "%s は照合できないためタイムアウト時は必ず 504（偽の成功にしない）",
    async (action, name) => {
      const adapter = new TimeoutMockAdapter("kitaqsign");
      setRegistrySetForTesting(
        createRegistrySet({ mode: "real", adapters: [adapter] }),
      );

      let id: string;
      if (action === "reject") {
        await sendJson("/domains", { name, period: 1 });
        const result = adapter.simulateInboundTransferRequest(name);
        id = (
          await recordOutboundTransferRequest(TEST_USER.id, adapter, result)
        ).id;
      } else {
        const authCode = `foreign-auth-${name}`;
        adapter.seedForeignDomain(name, authCode);
        const created = await sendJson("/transfers", { name, authCode });
        expect(created.status).toBe(202);
        id = ((await created.json()) as TransferPayload).record.id;
      }

      // 実際にはレジストリに届いていた（申請は消えている）が、拒否・取消は
      // 承認と区別できないので照合しない
      adapter.timeoutMode = "after-success";
      const res = await api(`/transfers/${id}/${action}`, { method: "POST" });
      expect(res.status).toBe(504);
      expect((await parseError(res)).error.code).toBe("REGISTRY_TIMEOUT");

      // 行は pending のまま残り、Poll 消化（#58）で確定させる
      const stored = await transferStore.findById(id);
      expect(stored?.status).toBe("pending");
    },
  );
});

describe("AC-01-3: 移管ルートの認証", () => {
  const SAMPLE_ID = "00000000-0000-4000-8000-000000000001";
  it.each([
    ["POST", "/api/v1/transfers"],
    ["GET", "/api/v1/transfers"],
    ["GET", `/api/v1/transfers/${SAMPLE_ID}`],
    ["POST", `/api/v1/transfers/${SAMPLE_ID}/approve`],
    ["POST", `/api/v1/transfers/${SAMPLE_ID}/reject`],
    ["POST", `/api/v1/transfers/${SAMPLE_ID}/cancel`],
  ])("%s %s は Cookie 無しで 401 UNAUTHORIZED", async (method, path) => {
    const res = await app.request(path, { method });
    expect(res.status).toBe(401);
    expect((await parseError(res)).error.code).toBe("UNAUTHORIZED");
  });
});
