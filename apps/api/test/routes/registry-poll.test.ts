import type { Db } from "@dopamin/db";
import {
  createRegistrySet,
  MockRegistryAdapter,
  RegistryError,
} from "@dopamin/registry";
import {
  type ApiError,
  apiErrorSchema,
  domainSyncWithPollResponseSchema,
  type PollConsumeResult,
  type PollMessage,
  pollConsumeResultSchema,
  type RegistryId,
  type TransferResult,
  type TransfersListResponse,
  transfersListResponseSchema,
} from "@dopamin/shared";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import app from "../../src/index";
import { setDbForTesting } from "../../src/lib/db";
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
import { createTestDb } from "../helpers/db";
import {
  clearTestSession,
  installTestSession,
  SESSION_COOKIE_HEADER,
  TEST_USER,
} from "../helpers/session";

/**
 * FR-12 / FR-02: Poll 消化（`POST /registry/poll`）と、それを裏で走らせる
 * `POST /domains/sync` / `GET /transfers` の統合テスト（AC-12-4 / AC-02-4）。
 */

let kitaqsign: MockRegistryAdapter;
let domainStore: DomainStore;
let transferStore: TransferStore;
let db: Db;
let closeDb: () => Promise<void>;

// domains / transfers 行はインメモリの seam 経由だが、詳細（FR-07）は
// サブドメイン設計の件数（#217）を DB から引くので接続先が要る。
// この DB に domains 行は入らないため、件数は常に null になる
beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
  setDbForTesting(db);
}, 30_000);

afterAll(async () => {
  setDbForTesting(null);
  await closeDb();
});

/** Poll の途中障害・ack 障害をピンポイントで再現するテスト用アダプタ。 */
class PollFaultAdapter extends MockRegistryAdapter {
  pollCalls = 0;
  failOnPollCall: number | null = null;
  failNextAck = false;
  failNextTransferQuery = false;
  keepMessageAfterAck = false;

  constructor(id: RegistryId) {
    super({ id });
  }

  private unavailable(command: string): RegistryError {
    return new RegistryError({
      code: "REGISTRY_UNAVAILABLE",
      registry: this.id,
      message: `${command}: メンテナンス中です（テスト用）`,
      httpStatus: 503,
    });
  }

  override async poll(): Promise<PollMessage | null> {
    this.pollCalls += 1;
    if (this.pollCalls === this.failOnPollCall) {
      throw this.unavailable("poll");
    }
    return super.poll();
  }

  override async ackMessage(id: string): Promise<void> {
    if (this.failNextAck) {
      this.failNextAck = false;
      throw this.unavailable("ack");
    }
    if (this.keepMessageAfterAck) {
      return;
    }
    return super.ackMessage(id);
  }

  override async transferQuery(name: string): Promise<TransferResult> {
    if (this.failNextTransferQuery) {
      this.failNextTransferQuery = false;
      throw this.unavailable("transferQuery");
    }
    return super.transferQuery(name);
  }
}

/**
 * 通知からレジストラ ID を落とすアダプタ（ADR-0002 決定 3 / #176 の実測形）。
 * 実レジストリの Poll は向きを導出できる ID を返さないので、その状況を作る。
 */
class AnonymousTransferAdapter extends MockRegistryAdapter {
  override async poll(): Promise<PollMessage | null> {
    const message = await super.poll();
    if (!message?.transfer) {
      return message;
    }
    return {
      ...message,
      transfer: {
        ...message.transfer,
        requestingRegistrarId: undefined,
        actingRegistrarId: undefined,
      },
    };
  }
}

/** 未知種別・対象不明の通知が ack されることを API 境界から確認する。 */
class SyntheticPollAdapter extends MockRegistryAdapter {
  private acknowledged = false;

  constructor(private readonly message: PollMessage) {
    super({ id: "kitaqsign" });
  }

  override async poll(): Promise<PollMessage | null> {
    return this.acknowledged ? null : this.message;
  }

  override async ackMessage(id: string): Promise<void> {
    expect(id).toBe(this.message.id);
    this.acknowledged = true;
  }
}

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

/** 保有一覧（FR-02）に見えているドメイン名。 */
async function visibleDomains(): Promise<string[]> {
  const res = await api("/domains");
  expect(res.status).toBe(200);
  const { domains } = (await res.json()) as { domains: { name: string }[] };
  return domains.map((d) => d.name);
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
    // レジストリ上は自レジストラがスポンサーだが、`domains` に行が無い状態。
    // 誰の物か決められないので、行は作らず ack だけして次の通知に進む
    kitaqsign.seedOwnedDomain("stranger.com");
    kitaqsign.simulateInboundTransferRequest("stranger.com");

    expect(await poll()).toEqual({
      processed: 1,
      created: 0,
      settled: 0,
      skipped: 1,
      failures: [],
    });
    expect(await transferStore.list(TEST_USER.id)).toEqual([]);
    // ack 済みなので同じ通知でキューが詰まらない
    expect(await poll()).toMatchObject({ processed: 0 });
  });

  it("対応する行が無い承認通知は、保有していなければ取り込まず skipped になる", async () => {
    // 自分が出した移管 IN の申請を相手が承認 → こちらに approved 通知。
    // その通知を読む前に行が失われた（別経路で確定済み等）状況を作る
    kitaqsign.seedForeignDomain("stranger.com", "auth-stranger");
    expect(
      (
        await sendJson("/transfers", {
          name: "stranger.com",
          authCode: "auth-stranger",
        })
      ).status,
    ).toBe(202);
    kitaqsign.simulateCounterpartApprove("stranger.com");
    setTransferStoreForTesting(createInMemoryTransferStore());
    // 登録・情報修正はユーザー × レジストリのコンタクトを引く（#72）
    setContactStoreForTesting(createInMemoryContactStore());

    expect(await poll()).toMatchObject({
      processed: 1,
      created: 0,
      settled: 0,
      skipped: 1,
    });
    // 対応する行が無く保有もしていないので、ドメインは作られない
    const res = await api("/domains");
    expect((await res.json()) as unknown).toEqual({ domains: [] });
  });

  it("レジストラ ID を返さないレジストリでも、取り込み済みの IN を移管 OUT と読み違えない", async () => {
    // 実レジストリの transferQuery / Poll は registrarId を返さない（ADR-0002）。
    // 向きが分からないまま「pending 行が無い承認通知」を OUT の完了と読むと、
    // 取り込んだばかりの保有行を transferred_out に倒して一覧から消してしまう
    const anonymous = new AnonymousTransferAdapter({ id: "kitaqsign" });
    setRegistrySetForTesting(
      createRegistrySet({ mode: "real", adapters: [anonymous] }),
    );
    anonymous.seedForeignDomain("anon.com", "auth-anon");
    const requested = await sendJson("/transfers", {
      name: "anon.com",
      authCode: "auth-anon",
    });
    expect(requested.status).toBe(202);
    const { record } = (await requested.json()) as { record: { id: string } };
    anonymous.simulateCounterpartApprove("anon.com");

    // 先に単票の照合（`info` の trDate。Poll を消化しない導線）が承認を検知して取り込む
    const detail = await api(`/transfers/${record.id}`);
    expect(detail.status).toBe(200);
    expect((await detail.json()) as unknown).toMatchObject({
      transfer: { domainName: "anon.com", direction: "in", status: "approved" },
    });
    const imported = await api("/domains");
    expect(
      ((await imported.json()) as { domains: { name: string }[] }).domains.map(
        (d) => d.name,
      ),
    ).toEqual(["anon.com"]);

    // そのあとで向きの分からない承認通知が届いても、保有行を倒さない
    expect(await poll()).toMatchObject({ processed: 1, skipped: 1 });

    const res = await api("/domains");
    expect(
      ((await res.json()) as { domains: { name: string }[] }).domains.map(
        (d) => d.name,
      ),
    ).toEqual(["anon.com"]);
    // 履歴も IN の 1 件だけで、OUT の行は起きていない
    const list = await listTransfers();
    expect(list.outbound).toEqual([]);
    expect(list.history).toHaveLength(1);
  });

  it("レジストラ ID を返さないレジストリでも、昔の移管 IN の履歴で移管 OUT を止めない（#244）", async () => {
    // 上のテストの裏返し。向きが分からない承認通知でも、IN の確定が**この通知より前**に
    // 済んでいるなら別の移管 = 移管 OUT の完了として読む。
    // 「承認済みの IN 行がある」だけで止めると、移管 IN で取得したドメインは
    // 以後どれだけ移管 OUT されても transferred_out に倒れなくなる
    const anonymous = new AnonymousTransferAdapter({
      id: "kitaqsign",
      // 申請を pending のうちに消化できない状況（OUT 行が手元に無いまま承認だけ届く）
      autoApproveMs: 0,
    });
    setRegistrySetForTesting(
      createRegistrySet({ mode: "real", adapters: [anonymous] }),
    );
    anonymous.seedForeignDomain("anon-out.com", "auth-anon-out");
    const requested = await sendJson("/transfers", {
      name: "anon-out.com",
      authCode: "auth-anon-out",
    });
    expect(requested.status).toBe(202);
    const { record } = (await requested.json()) as { record: { id: string } };

    // 移管 IN で取得する（期限 0 なのでサーバ自動承認で確定する）
    expect(await poll()).toMatchObject({ settled: 1 });
    expect(await visibleDomains()).toEqual(["anon-out.com"]);
    // その確定は「昔」の出来事にする（次の通知より前に済んでいる）
    await transferStore.update(record.id, {
      completedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    // 取得したドメインを移管 OUT する
    anonymous.simulateInboundTransferRequest("anon-out.com");
    expect(await poll()).toMatchObject({ processed: 2, settled: 1 });

    expect(await visibleDomains()).toEqual([]);
    // AC-12-5: 移管 OUT の完了が履歴に残る
    const list = await listTransfers();
    expect(list.outbound).toEqual([]);
    expect(
      list.history.filter(
        (t) => t.direction === "out" && t.status === "approved",
      ),
    ).toHaveLength(1);
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

  it("片方のレジストリがメンテナンス中でも、もう片方の通知は消化する（部分失敗）", async () => {
    const maintenance = new PollFaultAdapter("kitaqsign");
    maintenance.failOnPollCall = 1;
    const healthy = new MockRegistryAdapter({ id: "kitaqnic" });
    setRegistrySetForTesting(
      createRegistrySet({ mode: "real", adapters: [maintenance, healthy] }),
    );

    await createDomain("available-during-maintenance.xyz");
    healthy.simulateInboundTransferRequest("available-during-maintenance.xyz");

    const result = await poll();
    expect(result).toMatchObject({ processed: 1, created: 1 });
    expect(result.failures).toEqual([
      {
        registry: "kitaqsign",
        message: "Kitaqsign に接続できません。しばらくして再試行してください。",
      },
    ]);
    expect(await transferStore.list(TEST_USER.id)).toHaveLength(1);
  });

  it("複数通知の途中でメンテナンスに入っても、ack 済みまでを返し、残りは復旧後に続行する", async () => {
    const interrupted = new PollFaultAdapter("kitaqsign");
    setRegistrySetForTesting(
      createRegistrySet({ mode: "real", adapters: [interrupted] }),
    );
    kitaqsign = interrupted;

    await createDomain("before-maintenance.com");
    await createDomain("after-maintenance.com");
    interrupted.simulateInboundTransferRequest("before-maintenance.com");
    interrupted.simulateInboundTransferRequest("after-maintenance.com");
    interrupted.failOnPollCall = 2;

    const partial = await poll();
    expect(partial).toMatchObject({ processed: 1, created: 1 });
    expect(partial.failures).toHaveLength(1);
    expect(await transferStore.list(TEST_USER.id)).toHaveLength(1);

    const resumed = await poll();
    expect(resumed).toMatchObject({ processed: 1, created: 1, failures: [] });
    expect(await transferStore.list(TEST_USER.id)).toHaveLength(2);
  });

  it("通知の業務処理が失敗したら ack せず、復旧後に同じ通知を再処理する", async () => {
    const interrupted = new PollFaultAdapter("kitaqsign");
    setRegistrySetForTesting(
      createRegistrySet({ mode: "real", adapters: [interrupted] }),
    );
    kitaqsign = interrupted;

    await createDomain("retry-unacked.com");
    interrupted.simulateInboundTransferRequest("retry-unacked.com");
    interrupted.failNextTransferQuery = true;

    const failed = await poll();
    expect(failed).toMatchObject({ processed: 0, created: 0 });
    expect(failed.failures).toHaveLength(1);
    expect(await transferStore.list(TEST_USER.id)).toEqual([]);

    const recovered = await poll();
    expect(recovered).toMatchObject({ processed: 1, created: 1, failures: [] });
    expect(await transferStore.list(TEST_USER.id)).toHaveLength(1);
  });

  it("業務反映後に ack だけ失敗しても、再処理で transfers 行を重複作成・再計上しない", async () => {
    const interrupted = new PollFaultAdapter("kitaqsign");
    setRegistrySetForTesting(
      createRegistrySet({ mode: "real", adapters: [interrupted] }),
    );
    kitaqsign = interrupted;

    await createDomain("ack-retry.com");
    interrupted.simulateInboundTransferRequest("ack-retry.com");
    interrupted.failNextAck = true;

    const failed = await poll();
    expect(failed).toMatchObject({ processed: 0, created: 0 });
    expect(failed.failures).toHaveLength(1);
    // ack 前に業務反映は終わっているが、レスポンス上は未処理。行は 1 件だけ存在する
    expect(await transferStore.list(TEST_USER.id)).toHaveLength(1);

    const recovered = await poll();
    expect(recovered).toMatchObject({
      processed: 1,
      created: 0,
      settled: 0,
      skipped: 0,
      failures: [],
    });
    expect(await transferStore.list(TEST_USER.id)).toHaveLength(1);
  });

  it("ack が成功扱いでも通知が消えない異常時は 50 件で停止し、同じ行を増やさない", async () => {
    const stuck = new PollFaultAdapter("kitaqsign");
    stuck.keepMessageAfterAck = true;
    setRegistrySetForTesting(
      createRegistrySet({ mode: "real", adapters: [stuck] }),
    );
    kitaqsign = stuck;

    await createDomain("stuck-poll.com");
    stuck.simulateInboundTransferRequest("stuck-poll.com");

    const result = await poll();
    expect(result).toMatchObject({
      processed: 50,
      created: 1,
      settled: 0,
      skipped: 0,
      failures: [],
    });
    expect(await transferStore.list(TEST_USER.id)).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('"type":"poll_queue_not_drained"'),
    );
  });

  it.each([
    [
      "未知種別",
      {
        id: "9001",
        count: 1,
        queuedAt: "2026-08-27T00:00:00.000Z",
        type: "unknown",
        domainName: "unknown.com",
        raw: { msgType: "maintenance_notice" },
      } satisfies PollMessage,
    ],
    [
      "対象ドメイン不明",
      {
        id: "9002",
        count: 1,
        queuedAt: "2026-08-27T00:00:00.000Z",
        type: "transfer_request",
        raw: { msgType: "domain:transfer" },
      } satisfies PollMessage,
    ],
  ])("%s の通知は落とさず skipped として ack する", async (_label, message) => {
    const synthetic = new SyntheticPollAdapter(message);
    setRegistrySetForTesting(
      createRegistrySet({ mode: "real", adapters: [synthetic] }),
    );

    expect(await poll()).toEqual({
      processed: 1,
      created: 0,
      settled: 0,
      skipped: 1,
      failures: [],
    });
    expect(await poll()).toMatchObject({ processed: 0 });
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

  it("Poll エンドポイントだけがメンテナンス中でも、ドメイン同期は継続して障害内訳を返す", async () => {
    const interrupted = new PollFaultAdapter("kitaqsign");
    setRegistrySetForTesting(
      createRegistrySet({ mode: "real", adapters: [interrupted] }),
    );
    kitaqsign = interrupted;
    await createDomain("sync-during-poll-maintenance.com");
    interrupted.failOnPollCall = 1;

    const body = await sync();
    expect(body.pollProcessed).toMatchObject({ processed: 0, created: 0 });
    expect(body.pollProcessed.failures).toHaveLength(1);
    expect(body.domains).toEqual([
      expect.objectContaining({
        name: "sync-during-poll-maintenance.com",
        stale: false,
      }),
    ]);
    expect(body.failures).toEqual([]);
  });
});
