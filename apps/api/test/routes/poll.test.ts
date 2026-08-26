import { type Db, schema } from "@dopamin/db";
import { createRegistrySet, MockRegistryAdapter } from "@dopamin/registry";
import {
  type ApiErrorBody,
  apiErrorBodySchema,
  type DomainInfo,
  domainListResponseSchema,
  domainSyncResponseSchema,
  type PollMessage,
  registryPollResponseSchema,
  transfersListResponseSchema,
} from "@dopamin/shared";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import app from "../../src/index";
import { setDbForTesting } from "../../src/lib/db";
import { setRegistrySetForTesting } from "../../src/lib/registries";
import { createTestDb, resetTestDb } from "../helpers/db";
import { createTestSession } from "../helpers/session";

/**
 * FR-12 の Poll 消化（issue #58）の統合テスト。
 *
 * `POST /registry/poll` / `GET /transfers` / `POST /domains/sync` のどこから消化しても
 * 同じ反映になること、未 ack を残さないこと、二度届いても二重に反映しないことを見る。
 * `transfers` / `domains` への書き込みを検証するので pglite に本物のマイグレーションを当てる
 * （docs/testing.md §1）。
 */

let db: Db;
let closeDb: () => Promise<void>;
let kitaqsign: MockRegistryAdapter;
let kitaqnic: MockRegistryAdapter;
let self: Awaited<ReturnType<typeof createTestSession>>;
let other: Awaited<ReturnType<typeof createTestSession>>;
let consoleWarn: MockInstance<typeof console.warn>;

beforeAll(async () => {
  process.env.DATABASE_URL = "postgres://unused:unused@localhost:1/unused";
  process.env.WEBAUTHN_RP_ID = "localhost";
  process.env.WEBAUTHN_ORIGIN = "http://localhost:3000";
  ({ db, close: closeDb } = await createTestDb());
}, 30_000);

afterAll(async () => {
  setDbForTesting(null);
  await closeDb?.();
});

beforeEach(async () => {
  await resetTestDb(db);
  setDbForTesting(db);
  kitaqsign = new MockRegistryAdapter({ id: "kitaqsign" });
  kitaqnic = new MockRegistryAdapter({ id: "kitaqnic" });
  setRegistrySetForTesting(
    createRegistrySet({ mode: "real", adapters: [kitaqsign, kitaqnic] }),
  );
  self = await createTestSession(db, { displayName: "保有しているユーザー" });
  other = await createTestSession(db, { displayName: "別のユーザー" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  setRegistrySetForTesting(null);
  setDbForTesting(null);
  vi.restoreAllMocks();
});

async function api(
  path: string,
  init: RequestInit & { cookie?: string } = {},
): Promise<Response> {
  const { cookie, ...rest } = init;
  return app.request(`/api/v1${path}`, {
    ...rest,
    headers: { cookie: cookie ?? self.cookie, ...init.headers },
  });
}

function sendJson(
  path: string,
  body: unknown,
  init: RequestInit & { cookie?: string } = {},
): Promise<Response> {
  return api(path, {
    method: "POST",
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
    body: JSON.stringify(body),
  });
}

async function parseError(res: Response): Promise<ApiErrorBody> {
  return apiErrorBodySchema.parse(await res.json());
}

/** `POST /registry/poll`（デモ・検証用の明示トリガー）。 */
async function consume(cookie?: string) {
  const res = await api("/registry/poll", {
    method: "POST",
    ...(cookie ? { cookie } : {}),
  });
  expect(res.status).toBe(200);
  return registryPollResponseSchema.parse(await res.json()).poll;
}

async function listTransfers(cookie?: string) {
  const res = await api("/transfers", cookie ? { cookie } : {});
  expect(res.status).toBe(200);
  return transfersListResponseSchema.parse(await res.json());
}

async function listDomains(cookie?: string) {
  const res = await api("/domains", cookie ? { cookie } : {});
  expect(res.status).toBe(200);
  return domainListResponseSchema.parse(await res.json()).domains;
}

async function syncDomains(cookie?: string) {
  const res = await api("/domains/sync", {
    method: "POST",
    ...(cookie ? { cookie } : {}),
  });
  expect(res.status).toBe(200);
  return domainSyncResponseSchema.parse(await res.json());
}

/** 自分が保有するドメインを 1 件作る（移管 OUT の前提）。 */
async function createOwnedDomain(name: string, cookie?: string): Promise<void> {
  const res = await sendJson(
    "/domains",
    { name, period: 1 },
    cookie ? { cookie } : {},
  );
  expect(res.status).toBe(201);
}

/** 相手レジストラ保有のドメインを用意して移管 IN を申請する（AC-12-1）。 */
async function requestInbound(
  name: string,
  adapter: MockRegistryAdapter = kitaqsign,
): Promise<string> {
  const authCode = `auth-${name}`;
  adapter.seedForeignDomain(name, authCode);
  const res = await sendJson("/transfers", { name, authCode });
  expect(res.status).toBe(202);
  return authCode;
}

function selectTransfers() {
  return db.select().from(schema.transfers);
}

/** 構造化ログの spy から type が一致する最初の行を返す。 */
function findLogLine(type: string): Record<string, unknown> | undefined {
  return (
    consoleWarn.mock.calls
      .map((call) => {
        try {
          return JSON.parse(String(call[0])) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.type === type) ?? undefined
  );
}

describe("POST /api/v1/registry/poll（FR-12 Poll 消化）", () => {
  it("AC-12-4: 受信した移管申請が transfers(out, pending) になり /transfers に出る", async () => {
    await createOwnedDomain("wanted.com");
    kitaqsign.simulateInboundTransferRequest("wanted.com");

    expect(await consume()).toEqual({ processed: 1, failed: 0 });

    const rows = await selectTransfers();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: self.user.id,
      domainName: "wanted.com",
      registry: "kitaqsign",
      direction: "out",
      status: "pending",
      // 申請したのは相手レジストラ（ADR-0002 決定 3）
      counterpartRegistrarId: "MOCK-FOREIGN",
      completedAt: null,
    });
    // 移管 OUT は申請の時点で保有行があるので domain_id を紐付ける（§9.1）
    expect(rows[0]?.domainId).not.toBeNull();
    expect(rows[0]?.registryMessageId).not.toBeNull();
    // 自動承認の期限は申請から 20 分後（FR-12 / §9.2）
    expect(
      (rows[0]?.actByAt?.getTime() ?? 0) -
        (rows[0]?.requestedAt?.getTime() ?? 0),
    ).toBe(20 * 60 * 1000);

    const list = await listTransfers();
    expect(list.outbound).toHaveLength(1);
    expect(list.outbound[0]).toMatchObject({
      domainName: "wanted.com",
      direction: "out",
      status: "pending",
    });
    // 承認するまでは保有したまま
    expect((await listDomains()).map((d) => d.name)).toEqual(["wanted.com"]);
  });

  it("消化後は未 ack が残らない（FIFO を止めない）", async () => {
    await createOwnedDomain("first.com");
    await createOwnedDomain("second.com");
    kitaqsign.simulateInboundTransferRequest("first.com");
    kitaqsign.simulateInboundTransferRequest("second.com");

    expect(await consume()).toEqual({ processed: 2, failed: 0 });
    expect(await kitaqsign.poll()).toBeNull();
    expect(await consume()).toEqual({ processed: 0, failed: 0 });
    expect(await selectTransfers()).toHaveLength(2);
  });

  it("ack に失敗して同じ通知が二度届いても行は増えない（registry_message_id で冪等）", async () => {
    // 最初の ack だけ失敗するアダプタ。FIFO なので次の消化でも同じ通知が返る
    class FlakyAckAdapter extends MockRegistryAdapter {
      private failedOnce = false;
      override ackMessage(id: string): Promise<void> {
        if (!this.failedOnce) {
          this.failedOnce = true;
          return Promise.reject(new Error("ack failed（テスト）"));
        }
        return super.ackMessage(id);
      }
    }
    const adapter = new FlakyAckAdapter({ id: "kitaqsign" });
    setRegistrySetForTesting(
      createRegistrySet({ mode: "real", adapters: [adapter] }),
    );
    await createOwnedDomain("dup.com");
    adapter.simulateInboundTransferRequest("dup.com");

    // 1 回目: 反映はできたが ack に失敗した（通知は残る）
    expect(await consume()).toEqual({ processed: 0, failed: 1 });
    expect(await selectTransfers()).toHaveLength(1);
    expect(findLogLine("poll_apply_failed")).toMatchObject({
      registry: "kitaqsign",
      messageType: "transfer_request",
    });

    // 2 回目: 同じ通知が返るが、反映済みなので何もせず ack だけする
    expect(await consume()).toEqual({ processed: 1, failed: 0 });
    expect(await adapter.poll()).toBeNull();
    const rows = await selectTransfers();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ direction: "out", status: "pending" });
  });

  it("複数レジストリのキューをまとめて消化する", async () => {
    await createOwnedDomain("both.com");
    await createOwnedDomain("both.xyz");
    kitaqsign.simulateInboundTransferRequest("both.com");
    kitaqnic.simulateInboundTransferRequest("both.xyz");

    expect(await consume()).toEqual({ processed: 2, failed: 0 });
    const rows = await selectTransfers();
    expect(rows.map((r) => r.registry).sort()).toEqual([
      "kitaqnic",
      "kitaqsign",
    ]);
  });

  it("1 つのレジストリが落ちても他のレジストリの消化は続く（部分失敗）", async () => {
    await createOwnedDomain("alive.com");
    kitaqsign.simulateInboundTransferRequest("alive.com");
    kitaqnic.setFailMode("5xx");

    expect(await consume()).toEqual({ processed: 1, failed: 1 });
    expect(await selectTransfers()).toHaveLength(1);
    expect(findLogLine("poll_failed")).toMatchObject({
      registry: "kitaqnic",
      code: "REGISTRY_UNAVAILABLE",
    });
  });

  it("保有していないドメインの通知は ack して先へ進む（キューを止めない）", async () => {
    // 保有行を作らずにレジストリ側だけで移管申請を起こす
    kitaqsign.seedForeignDomain("stranger.com", "auth-stranger");
    await sendJson("/transfers", {
      name: "stranger.com",
      authCode: "auth-stranger",
    });
    // 申請の通知は相手レジストラ側のキューに積まれるので、こちらには来ない。
    // 代わりに相手が拒否したことにして、行の無い完了通知を作る
    await db.delete(schema.transfers);
    kitaqsign.simulateCounterpartReject("stranger.com");

    expect(await consume()).toEqual({ processed: 1, failed: 0 });
    expect(await kitaqsign.poll()).toBeNull();
    expect(await selectTransfers()).toEqual([]);
    expect(findLogLine("poll_message_unattributed")).toMatchObject({
      domain: "stranger.com",
      messageType: "transfer_rejected",
    });
  });

  it("未知の種別は ack して先へ進む（残すと以降の通知が読めない）", async () => {
    let acked: string | null = null;
    class UnknownMessageAdapter extends MockRegistryAdapter {
      private delivered = false;
      override poll(): Promise<PollMessage | null> {
        if (this.delivered) {
          return Promise.resolve(null);
        }
        return Promise.resolve({
          id: "999",
          count: 1,
          queuedAt: "2026-08-26T00:00:00.000Z",
          type: "unknown",
          raw: { msgType: "somethingNew" },
        });
      }
      override ackMessage(id: string): Promise<void> {
        acked = id;
        this.delivered = true;
        return Promise.resolve();
      }
    }
    setRegistrySetForTesting(
      createRegistrySet({
        mode: "real",
        adapters: [new UnknownMessageAdapter({ id: "kitaqsign" })],
      }),
    );

    expect(await consume()).toEqual({ processed: 1, failed: 0 });
    expect(acked).toBe("999");
    expect(findLogLine("poll_message_unknown")).toMatchObject({
      registry: "kitaqsign",
      messageId: "999",
    });
  });

  it("AC-01-3: Cookie 無しは 401 UNAUTHORIZED", async () => {
    const res = await app.request("/api/v1/registry/poll", { method: "POST" });
    expect(res.status).toBe(401);
    expect((await parseError(res)).error.code).toBe("UNAUTHORIZED");
  });
});

describe("Poll による移管の確定（FR-12 / §6.5）", () => {
  it("AC-12-5: サーバ自動承認された移管 OUT は transferred_out になり保有一覧から消える", async () => {
    // 放置された申請を即座に自動承認する mock（§17 MOCK_TRANSFER_AUTO_APPROVE_MS）
    const adapter = new MockRegistryAdapter({
      id: "kitaqsign",
      autoApproveMs: 0,
    });
    setRegistrySetForTesting(
      createRegistrySet({ mode: "real", adapters: [adapter] }),
    );
    await createOwnedDomain("timeout.com");
    adapter.simulateInboundTransferRequest("timeout.com");

    // 申請の通知 → 自動承認の通知の順に届く（FIFO）
    const summary = await consume();
    expect(summary.failed).toBe(0);
    expect(summary.processed).toBeGreaterThanOrEqual(2);

    const rows = await selectTransfers();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ direction: "out", status: "approved" });
    expect(rows[0]?.completedAt).not.toBeNull();

    expect(await listDomains()).toEqual([]);
    const [domain] = await db
      .select()
      .from(schema.domains)
      .where(eq(schema.domains.name, "timeout.com"));
    expect(domain?.ownership).toBe("transferred_out");
    expect(domain?.transferredOutAt).not.toBeNull();
  });

  it("AC-12-3: 移管 IN の承認通知でドメインを取り込む", async () => {
    await requestInbound("incoming.com");
    kitaqsign.simulateCounterpartApprove("incoming.com");

    expect(await consume()).toEqual({ processed: 1, failed: 0 });

    const [row] = await selectTransfers();
    expect(row).toMatchObject({ direction: "in", status: "approved" });
    expect(row?.domainId).not.toBeNull();
    expect((await listDomains()).map((d) => d.name)).toEqual(["incoming.com"]);
  });

  it("移管 IN の拒否通知は rejected として履歴に残し、取り込まない", async () => {
    await requestInbound("refused.com");
    kitaqsign.simulateCounterpartReject("refused.com");

    await consume();

    const list = await listTransfers();
    expect(list.inbound).toEqual([]);
    expect(list.history).toHaveLength(1);
    expect(list.history[0]).toMatchObject({
      status: "rejected",
      direction: "in",
      domainId: null,
    });
    expect(await listDomains()).toEqual([]);
  });

  it("承認通知が一覧の照合より遅れて届いても、保有行を transferred_out にしない", async () => {
    await requestInbound("late.com");
    kitaqsign.simulateCounterpartApprove("late.com");
    // 先に一覧の照合（info の trDate）が承認を検知して取り込む
    const [row] = await db
      .select()
      .from(schema.transfers)
      .where(eq(schema.transfers.domainName, "late.com"));
    const detail = await api(`/transfers/${row?.id}`);
    expect(detail.status).toBe(200);
    expect((await listDomains()).map((d) => d.name)).toEqual(["late.com"]);

    // そのあとで同じ移管の承認通知が届く
    expect(await consume()).toEqual({ processed: 1, failed: 0 });

    expect((await listDomains()).map((d) => d.name)).toEqual(["late.com"]);
    expect(findLogLine("poll_message_already_settled")).toMatchObject({
      domain: "late.com",
    });
  });

  it("AC-02-1: 他ユーザーの保有ドメイン宛の通知は自分の一覧に出ない", async () => {
    await createOwnedDomain("theirs.com", other.cookie);
    kitaqsign.simulateInboundTransferRequest("theirs.com");

    await consume();

    expect(await listTransfers()).toEqual({
      inbound: [],
      outbound: [],
      history: [],
    });
    expect((await listTransfers(other.cookie)).outbound).toHaveLength(1);
  });
});

describe("POST /api/v1/domains/sync（FR-02 / FR-12 の最新化）", () => {
  it("同期と同時に Poll を消化し、件数を返す", async () => {
    await createOwnedDomain("synced.com");
    kitaqsign.simulateInboundTransferRequest("synced.com");

    const result = await syncDomains();
    expect(result.poll).toEqual({ processed: 1, failed: 0 });
    expect(result.domains.map((d) => d.name)).toEqual(["synced.com"]);
    expect((await listTransfers()).outbound).toHaveLength(1);
  });

  it("AC-02-4: 移管 OUT が完了したドメインは最新化で一覧から消える", async () => {
    const adapter = new MockRegistryAdapter({
      id: "kitaqsign",
      autoApproveMs: 0,
    });
    setRegistrySetForTesting(
      createRegistrySet({ mode: "real", adapters: [adapter] }),
    );
    await createOwnedDomain("leaving.com");
    adapter.simulateInboundTransferRequest("leaving.com");

    // 1 回目: 申請と自動承認の通知を消化して transferred_out に倒す
    const first = await syncDomains();
    expect(first.poll.failed).toBe(0);
    // 2 回目: 保有行が無くなっているので同期対象も 0 件
    const second = await syncDomains();
    expect(second.domains).toEqual([]);
    expect(await listDomains()).toEqual([]);
  });

  it("Poll を取りこぼしても、info の pendingTransfer から transfers(out) を作る", async () => {
    // 通知を積まないアダプタ（実レジストリで通知が届かない・遅れる状況）
    class NoPollAdapter extends MockRegistryAdapter {
      override poll(): Promise<null> {
        return Promise.resolve(null);
      }
    }
    const adapter = new NoPollAdapter({ id: "kitaqsign" });
    setRegistrySetForTesting(
      createRegistrySet({ mode: "real", adapters: [adapter] }),
    );
    await createOwnedDomain("silentout.com");
    adapter.simulateInboundTransferRequest("silentout.com");

    const result = await syncDomains();
    expect(result.poll).toEqual({ processed: 0, failed: 0 });

    const rows = await selectTransfers();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      domainName: "silentout.com",
      direction: "out",
      status: "pending",
      // Poll 由来ではないので通知 ID は持たない
      registryMessageId: null,
    });
    // 何度同期しても行は増えない
    await syncDomains();
    expect(await selectTransfers()).toHaveLength(1);
  });

  it("info の clID が自レジストラでなければ transferred_out に倒す（§6.5）", async () => {
    // 実レジストリの info には clID が無いため当面 null【要確認: §21.2 #12】。
    // 返るようになったときに効く経路を、clID を返すアダプタで確かめる
    class SponsoredElsewhereAdapter extends MockRegistryAdapter {
      override async info(name: string): Promise<DomainInfo> {
        const info = await super.info(name);
        return { ...info, sponsoringRegistrarId: "OTHER-REGISTRAR" };
      }
    }
    setRegistrySetForTesting(
      createRegistrySet({
        mode: "real",
        adapters: [new SponsoredElsewhereAdapter({ id: "kitaqsign" })],
      }),
    );
    await createOwnedDomain("gone.com");

    const result = await syncDomains();
    expect(result.domains).toEqual([]);
    expect(await listDomains()).toEqual([]);
    const [domain] = await db
      .select()
      .from(schema.domains)
      .where(eq(schema.domains.name, "gone.com"));
    expect(domain?.ownership).toBe("transferred_out");
  });
});
