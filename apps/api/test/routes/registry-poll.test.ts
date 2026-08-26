import { createRegistrySet, MockRegistryAdapter } from "@dopamin/registry";
import {
  type ApiError,
  apiErrorSchema,
  domainSyncWithPollResponseSchema,
  type PollConsumeResult,
  pollConsumeResultSchema,
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
import {
  createInMemoryTransferStore,
  setTransferStoreForTesting,
  type TransferStore,
} from "../../src/services/transfer-store";
import {
  clearTestSession,
  installTestSession,
  SESSION_COOKIE_HEADER,
} from "../helpers/session";

/**
 * FR-12 / FR-02: Poll 消化（`POST /registry/poll`）と、それを裏で走らせる
 * `POST /domains/sync` / `GET /transfers` の統合テスト（AC-12-4 / AC-02-4）。
 */

let kitaqsign: MockRegistryAdapter;
let domainStore: DomainStore;
let transferStore: TransferStore;

/** 放置された申請をその場でサーバ自動承認させるアダプタを組む（§11.1 の遅延評価）。 */
function installRegistry(options: { autoApproveMs?: number } = {}): void {
  kitaqsign = new MockRegistryAdapter({
    id: "kitaqsign",
    ...(options.autoApproveMs === undefined
      ? {}
      : { autoApproveMs: options.autoApproveMs }),
  });
  setRegistrySetForTesting(
    createRegistrySet({ mode: "real", adapters: [kitaqsign] }),
  );
}

beforeEach(() => {
  // 参照系の自動再試行（#60）のバックオフでテストが待たされないようにする
  setRetrySleepForTesting(() => Promise.resolve());

  installRegistry();
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

async function api(path: string, init?: RequestInit): Promise<Response> {
  return app.request(`/api/v1${path}`, {
    ...init,
    headers: { cookie: SESSION_COOKIE_HEADER, ...init?.headers },
  });
}

function sendJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function parseError(res: Response): Promise<ApiError> {
  return apiErrorSchema.parse(await res.json());
}

async function poll(): Promise<PollConsumeResult> {
  const res = await api("/registry/poll", { method: "POST" });
  expect(res.status).toBe(200);
  return pollConsumeResultSchema.parse(await res.json());
}

async function listTransfers(): Promise<TransfersListResponse> {
  const res = await api("/transfers");
  expect(res.status).toBe(200);
  return transfersListResponseSchema.parse(await res.json());
}

async function sync() {
  const res = await api("/domains/sync", { method: "POST" });
  expect(res.status).toBe(200);
  return domainSyncWithPollResponseSchema.parse(await res.json());
}

/** 自分の保有ドメインを 1 件作る。 */
async function createDomain(name: string): Promise<void> {
  expect((await sendJson("/domains", { name, period: 1 })).status).toBe(201);
}

describe("POST /api/v1/registry/poll（FR-12 Poll 消化）", () => {
  it("通知が無ければ 0 件で返る", async () => {
    expect(await poll()).toEqual({
      processed: 0,
      created: 0,
      settled: 0,
      skipped: 0,
      failures: [],
    });
  });

  it("AC-12-4: 受信した transfer request が消化後に /transfers に出る", async () => {
    await createDomain("inbox.com");
    kitaqsign.simulateInboundTransferRequest("inbox.com");

    // 消化前は移管一覧に何も無い（一覧側も消化するので、まず Poll だけを叩く）
    expect(await transferStore.list("x")).toEqual([]);

    expect(await poll()).toMatchObject({ processed: 1, created: 1 });

    const list = await listTransfers();
    expect(list.outbound).toHaveLength(1);
    expect(list.outbound[0]).toMatchObject({
      domainName: "inbox.com",
      direction: "out",
      status: "pending",
      counterpartRegistrarId: "MOCK-FOREIGN",
    });
    // 受信した申請なので保有ドメインの行に紐付く
    expect(list.outbound[0]?.domainId).not.toBeNull();
  });

  it("同じ通知を二度消化しても行は増えない（registry_message_id で冪等）", async () => {
    await createDomain("once.com");
    kitaqsign.simulateInboundTransferRequest("once.com");

    expect(await poll()).toMatchObject({ created: 1 });
    // ack 済みなので 2 回目は何も無い
    expect(await poll()).toMatchObject({ processed: 0, created: 0 });
    expect((await listTransfers()).outbound).toHaveLength(1);
  });

  it("AC-12-3: 相手の承認通知でドメインが取り込まれる（移管 IN の完了）", async () => {
    kitaqsign.seedForeignDomain("gain.com", "auth-gain");
    expect(
      (
        await sendJson("/transfers", {
          name: "gain.com",
          authCode: "auth-gain",
        })
      ).status,
    ).toBe(202);
    kitaqsign.simulateCounterpartApprove("gain.com");

    expect(await poll()).toMatchObject({ processed: 1, settled: 1 });

    const list = await listTransfers();
    expect(list.inbound).toEqual([]);
    expect(list.history[0]).toMatchObject({
      domainName: "gain.com",
      direction: "in",
      status: "approved",
    });
    expect(list.history[0]?.domainId).not.toBeNull();
    // 取り込まれて保有一覧に出る
    const res = await api("/domains");
    const { domains } = (await res.json()) as { domains: { name: string }[] };
    expect(domains.map((d) => d.name)).toEqual(["gain.com"]);
  });

  it("相手の拒否通知は rejected として記録され、取り込まれない", async () => {
    kitaqsign.seedForeignDomain("deny.com", "auth-deny");
    expect(
      (
        await sendJson("/transfers", {
          name: "deny.com",
          authCode: "auth-deny",
        })
      ).status,
    ).toBe(202);
    kitaqsign.simulateCounterpartReject("deny.com");

    expect(await poll()).toMatchObject({ settled: 1 });

    const list = await listTransfers();
    expect(list.history[0]).toMatchObject({
      domainName: "deny.com",
      status: "rejected",
      domainId: null,
    });
    const res = await api("/domains");
    expect((await res.json()) as unknown).toEqual({ domains: [] });
  });

  it("保有していないドメインの申請通知は ack だけして skipped になる", async () => {
    // 相手レジストラ保有のドメインに、こちらは何も持っていない状態で通知が届く
    kitaqsign.seedForeignDomain("stranger.com", "auth-stranger");
    kitaqsign.simulateInboundTransferRequest;
    // 自分宛のキューに直接積まれる状況は作れないので、申請 → 取消で通知だけ残す
    expect(
      (
        await sendJson("/transfers", {
          name: "stranger.com",
          authCode: "auth-stranger",
        })
      ).status,
    ).toBe(202);
    // 自分が出した申請を相手が承認 → こちらに approved 通知。行は消しておく
    kitaqsign.simulateCounterpartApprove("stranger.com");
    setTransferStoreForTesting(createInMemoryTransferStore());
    // 登録・情報修正はユーザー × レジストリのコンタクトを引く（#72）
    setContactStoreForTesting(createInMemoryContactStore());

    const result = await poll();
    expect(result.processed).toBe(1);
    expect(result.settled + result.skipped).toBe(1);
    // 対応する行が無く保有もしていないので、ドメインは作られない
    const res = await api("/domains");
    expect((await res.json()) as unknown).toEqual({ domains: [] });
  });

  it("キューに溜まった複数の通知を一度で消化しきる（FIFO を詰まらせない）", async () => {
    await createDomain("a-multi.com");
    await createDomain("b-multi.com");
    kitaqsign.simulateInboundTransferRequest("a-multi.com");
    kitaqsign.simulateInboundTransferRequest("b-multi.com");

    expect(await poll()).toMatchObject({ processed: 2, created: 2 });
    expect(await poll()).toMatchObject({ processed: 0 });
    expect((await listTransfers()).outbound).toHaveLength(2);
  });

  it("AC-01-3: Cookie 無しは 401 UNAUTHORIZED", async () => {
    const res = await app.request("/api/v1/registry/poll", { method: "POST" });
    expect(res.status).toBe(401);
    expect((await parseError(res)).error.code).toBe("UNAUTHORIZED");
  });
});

describe("POST /api/v1/domains/sync（FR-02 / FR-12 の最新化）", () => {
  it("応答に Poll 消化の内訳が載る", async () => {
    const body = await sync();
    expect(body.pollProcessed).toEqual({
      processed: 0,
      created: 0,
      settled: 0,
      skipped: 0,
      failures: [],
    });
  });

  it("info の pendingTransfer から受信中の移管申請を拾う（通知を取りこぼした場合の保険）", async () => {
    await createDomain("detect.com");
    kitaqsign.simulateInboundTransferRequest("detect.com");
    // 申請の通知を先に捨ててしまった状況を作る
    const message = await kitaqsign.poll();
    if (!message) {
      throw new Error("通知が積まれていない");
    }
    await kitaqsign.ackMessage(message.id);

    await sync();

    const list = await listTransfers();
    expect(list.outbound).toHaveLength(1);
    expect(list.outbound[0]).toMatchObject({
      domainName: "detect.com",
      direction: "out",
      status: "pending",
    });
  });

  it("AC-02-4: 移管 OUT が完了したドメインは最新化で一覧から消える", async () => {
    // サーバ自動承認をその場で起こす（§11.1 の遅延評価。期限は poll / info で判定される）
    installRegistry({ autoApproveMs: 0 });
    await createDomain("bye.com");
    kitaqsign.simulateInboundTransferRequest("bye.com");

    const body = await sync();

    // 申請と承認の通知が同時に届く。申請の方は既に決着済みなので作らず（skipped）、
    // 承認の方が「対応する行が無い移管 OUT の完了」として履歴を作って所有権を倒す
    expect(body.pollProcessed).toMatchObject({
      processed: 2,
      skipped: 1,
      settled: 1,
    });
    expect(body.domains.map((d) => d.name)).toEqual([]);
    expect((await domainStore.find("bye.com"))?.ownership).toBe(
      "transferred_out",
    );
    // 履歴には残る
    const list = await listTransfers();
    expect(list.history[0]).toMatchObject({
      domainName: "bye.com",
      direction: "out",
      status: "approved",
    });
  });

  it("保有しているドメインは最新化で残る（フィルタが効きすぎない）", async () => {
    await createDomain("keep.com");
    const body = await sync();
    expect(body.domains.map((d) => d.name)).toEqual(["keep.com"]);
    expect(body.failures).toEqual([]);
  });
});
