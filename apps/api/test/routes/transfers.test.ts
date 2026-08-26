import { type Db, schema } from "@dopamin/db";
import {
  createRegistrySet,
  MockRegistryAdapter,
  RegistryError,
} from "@dopamin/registry";
import {
  type ApiErrorBody,
  apiErrorBodySchema,
  type ClientStatus,
  domainListResponseSchema,
  type TransferResult,
  transferDetailResponseSchema,
  transferResponseSchema,
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
import { z } from "zod";
import app from "../../src/index";
import { setDbForTesting } from "../../src/lib/db";
import { setRegistrySetForTesting } from "../../src/lib/registries";
import { createTestDb, resetTestDb } from "../helpers/db";
import { createTestSession } from "../helpers/session";
import { TimeoutMockAdapter } from "../helpers/timeout-mock";

/**
 * FR-12（移管 IN の申請・永続化・承認検知）の統合テスト（issue #56）。
 *
 * `transfers` への書き込みを検証するので、in-memory ストアではなく pglite に本物の
 * マイグレーションを当てて実 SQL を通す（docs/testing.md §1）。`domains` 側も
 * `setDomainStoreForTesting` を使わず既定の DB 実装のまま動かす
 * （`transfers.domain_id` は `domains.id` への FK なので、片方だけ in-memory にできない）。
 */

/**
 * `POST /transfers` の応答（正規化 `TransferResult` から `raw` を除いた DTO。ADR-0002）。
 * 形は shared の `transferResponseSchema` が正。ここで写しを作ると、
 * ルートが余計なキー（`raw` など）を足しても素通りしてしまう。
 */
const transferEnvelopeSchema = z.object({
  transfer: transferResponseSchema,
});

/** originCheck（§10.2）が照合する正規の Origin。 */
const APP_ORIGIN = "http://localhost:3000";

let db: Db;
let closeDb: () => Promise<void>;
let kitaqsign: MockRegistryAdapter;
let kitaqnic: MockRegistryAdapter;
let self: Awaited<ReturnType<typeof createTestSession>>;
let other: Awaited<ReturnType<typeof createTestSession>>;
let consoleWarn: MockInstance<typeof console.warn>;

beforeAll(async () => {
  // originCheck は Origin ヘッダ付きの更新系リクエストでだけ env() を評価する
  process.env.DATABASE_URL = "postgres://unused:unused@localhost:1/unused";
  process.env.WEBAUTHN_RP_ID = "localhost";
  process.env.WEBAUTHN_ORIGIN = APP_ORIGIN;
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
  self = await createTestSession(db, { displayName: "申請したユーザー" });
  other = await createTestSession(db, { displayName: "別のユーザー" });
  // レジストリ拒否の console.error（error-handler）と照合失敗の警告でテスト出力が汚れないようにする
  vi.spyOn(console, "error").mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  setRegistrySetForTesting(null);
  setDbForTesting(null);
  vi.restoreAllMocks();
});

/**
 * Poll 通知が届かないレジストリ。移管の確定を `transferQuery` / `info` からしか
 * 知りようがない状況（#56 の照合経路）を再現する。
 *
 * 通常の経路では Poll が主情報源（ADR-0002 決定 1）だが、実レジストリが通知を
 * 積まないケース・通知がまだ届いていないケースでも壊れないことを確かめるのに使う。
 */
class NoPollAdapter extends MockRegistryAdapter {
  override poll(): Promise<null> {
    return Promise.resolve(null);
  }
}

/** 認証済みリクエスト（移管操作も認証必須。AC-01-3）。 */
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

/**
 * レジストリ側にだけドメインを用意する（アプリの `domains` 行は作らない）。
 *
 * `POST /domains` や `adapter.create` で作ると申請者自身の保有ドメインになり、
 * 移管 IN の申請そのものが 409 になる（#45 で mock がスポンサーを見るようになった）。
 * 相手レジストラが保有している状態を再現するため、mock の seed を直接叩く。
 */
function seedForeignDomain(
  adapter: MockRegistryAdapter,
  name: string,
  options?: { clientStatuses?: readonly ClientStatus[] },
  authCode = "auth-code-1234",
): string {
  adapter.seedForeignDomain(name, authCode, options);
  return authCode;
}

/**
 * 相手レジストラ保有で、かつ**過去の移管履歴（`trDate`）を持つ**ドメインを作る。
 *
 * mock は状態遷移でしか `trDate` を刻まないので、「一度こちらへ移管 IN してから
 * こちらから移管 OUT する」ことで本物の履歴を作る。戻り値は移管 OUT 時に発行した
 * AuthCode で、そのまま次の移管 IN 申請に使える。
 */
async function seedForeignDomainWithPastTransfer(
  adapter: MockRegistryAdapter,
  name: string,
): Promise<string> {
  const seedCode = seedForeignDomain(adapter, name);
  await adapter.transferRequest(name, seedCode);
  // 相手が承認 → こちらの保有になり trDate が付く
  adapter.simulateCounterpartApprove(name);
  const authCode = await adapter.authCode(name);
  // 相手が申請 → こちらが承認して手放す（再び相手レジストラ保有に戻る）
  adapter.simulateInboundTransferRequest(name);
  await adapter.transferApprove(name);
  return authCode;
}

/** 自分が保有するドメインを 1 件作る（移管 OUT の前提）。 */
async function createOwnedDomain(name: string): Promise<void> {
  const res = await sendJson("/domains", { name, period: 1 });
  expect(res.status).toBe(201);
}

/**
 * 相手レジストラからの移管申請を受信した状態を作り、Poll 消化で
 * `transfers(out, pending)` まで進める（AC-12-4 の前提）。行の id を返す。
 */
async function receiveInboundRequest(
  name: string,
  adapter: MockRegistryAdapter = kitaqsign,
): Promise<string> {
  await createOwnedDomain(name);
  adapter.simulateInboundTransferRequest(name);
  const list = await listTransfers();
  expect(list.outbound).toHaveLength(1);
  const id = list.outbound[0]?.id;
  expect(id).toBeDefined();
  return id ?? "";
}

/** 申請 → 202 を確認して transfers 行を返す。 */
async function requestTransfer(name: string, authCode: string) {
  const res = await sendJson("/transfers", { name, authCode });
  expect(res.status).toBe(202);
  transferEnvelopeSchema.parse(await res.json());
  return selectTransfers();
}

function selectTransfers() {
  return db.select().from(schema.transfers);
}

/** 構造化ログの spy から type が一致する最初の行を返す。 */
function findLogLine(
  spy: MockInstance<typeof console.warn>,
  type: string,
): Record<string, unknown> | undefined {
  return (
    spy.mock.calls
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

describe("POST /api/v1/transfers（FR-12 移管 IN の申請と永続化）", () => {
  it("AC-12-1: 申請が受理されると pending の transfers 行ができ、保有一覧には出ない", async () => {
    const authCode = seedForeignDomain(kitaqsign, "move.com");

    const res = await sendJson("/transfers", { name: "move.com", authCode });
    expect(res.status).toBe(202);
    const { transfer } = transferEnvelopeSchema.parse(await res.json());
    // 申請したのは自レジストラなので requesting = 自分、対応するのは相手レジストラ（ADR-0002 決定 3）
    expect(transfer).toMatchObject({
      name: "move.com",
      status: "pending",
      requestingRegistrarId: "MOCK-REGISTRAR",
      actingRegistrarId: "MOCK-FOREIGN",
    });

    const rows = await selectTransfers();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({
      userId: self.user.id,
      domainName: "move.com",
      registry: "kitaqsign",
      direction: "in",
      status: "pending",
      // 相手レジストラ = 自分でない側（ADR-0002 決定 3）
      counterpartRegistrarId: "MOCK-FOREIGN",
      // 承認を検知するまで domains には紐付けない（§6.5）
      domainId: null,
      completedAt: null,
    });
    expect(row?.raw).not.toBeNull();
    // 自動承認の期限は申請から 20 分後（FR-12 / §9.2）
    expect(
      (row?.actByAt?.getTime() ?? 0) - (row?.requestedAt?.getTime() ?? 0),
    ).toBe(20 * 60 * 1000);

    // 一覧では inbound（進行中の移管 IN）に出る
    const list = await listTransfers();
    expect(list.inbound).toHaveLength(1);
    expect(list.inbound[0]).toMatchObject({
      id: row?.id,
      domainName: "move.com",
      registry: "kitaqsign",
      direction: "in",
      status: "pending",
      domainId: null,
    });
    expect(list.outbound).toEqual([]);
    expect(list.history).toEqual([]);

    // AC-12-1: 保有一覧には出ない（domains 行を作っていない）
    expect(await listDomains()).toEqual([]);
  });

  it("AC-12-2: 誤った AuthCode は 422 REGISTRY_REJECTED で、行は作らない", async () => {
    seedForeignDomain(kitaqsign, "wrong.com");
    const res = await sendJson("/transfers", {
      name: "wrong.com",
      authCode: "wrong-auth-code",
    });
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(apiErrorBodySchema.parse(JSON.parse(text)).error).toMatchObject({
      code: "REGISTRY_REJECTED",
      registry: "kitaqsign",
      registryCode: "2202",
      retryable: false,
    });
    // レジストリの生メッセージはユーザー向けメッセージに置き換える（FR-18）
    expect(text).not.toContain("一致しません");
    expect(await selectTransfers()).toEqual([]);
  });

  it("clientTransferProhibited 中の申請は 409 OPERATION_NOT_ALLOWED で、行は作らない", async () => {
    // ロックを掛けているのは現スポンサー（相手レジストラ）側
    const authCode = seedForeignDomain(kitaqsign, "lock.com", {
      clientStatuses: ["clientTransferProhibited"],
    });
    const res = await sendJson("/transfers", { name: "lock.com", authCode });
    expect(res.status).toBe(409);
    expect((await parseError(res)).error.code).toBe("OPERATION_NOT_ALLOWED");
    expect(await selectTransfers()).toEqual([]);
  });

  it("未登録ドメインへの申請は 404 NOT_FOUND", async () => {
    const res = await sendJson("/transfers", {
      name: "ghost.com",
      authCode: "whatever",
    });
    expect(res.status).toBe(404);
    expect((await parseError(res)).error.code).toBe("NOT_FOUND");
    expect(await selectTransfers()).toEqual([]);
  });

  it("authCode が空なら 400 VALIDATION_ERROR", async () => {
    const res = await sendJson("/transfers", { name: "a.com", authCode: "" });
    expect(res.status).toBe(400);
    expect((await parseError(res)).error.code).toBe("VALIDATION_ERROR");
    expect(await selectTransfers()).toEqual([]);
  });

  it("同じドメインへの再申請でも pending 行は 1 件のまま、申請時の値も巻き戻さない", async () => {
    // 実レジストリの transferQuery は name / status / raw しか返さない。
    // 再申請の照合結果をそのまま上書きすると、申請日時・自動承認期限・相手レジストラ ID が
    // 潰れて画面のカウントダウンと承認検知の基準が壊れる。
    class SparseTimeoutAdapter extends TimeoutMockAdapter {
      override async transferQuery(name: string): Promise<TransferResult> {
        const result = await super.transferQuery(name);
        return { name: result.name, status: result.status, raw: result.raw };
      }
    }
    const adapter = new SparseTimeoutAdapter("kitaqsign");
    setRegistrySetForTesting(
      createRegistrySet({ mode: "real", adapters: [adapter] }),
    );
    const authCode = seedForeignDomain(adapter, "twice.com");

    const [before] = await requestTransfer("twice.com", authCode);
    // 2 回目: レジストリには既に届いているので transferRequest はタイムアウト扱いにし、
    // transferQuery（pending）で受理済みと確認される経路を通す
    adapter.timeoutMode = "before-reach";
    const res = await sendJson("/transfers", {
      name: "twice.com",
      authCode,
    });
    expect(res.status).toBe(202);

    const rows = await selectTransfers();
    expect(rows).toHaveLength(1);
    const after = rows[0];
    expect(after?.status).toBe("pending");
    expect(after?.requestedAt?.toISOString()).toBe(
      before?.requestedAt?.toISOString(),
    );
    expect(after?.actByAt?.toISOString()).toBe(before?.actByAt?.toISOString());
    expect(after?.counterpartRegistrarId).toBe("MOCK-FOREIGN");
    expect(after?.registryStatus).toBe(before?.registryStatus);
  });
});

describe("AC-18-2 / ADR-0002: 移管申請タイムアウト時の照合", () => {
  let adapter: TimeoutMockAdapter;

  beforeEach(() => {
    adapter = new TimeoutMockAdapter("kitaqsign");
    setRegistrySetForTesting(
      createRegistrySet({ mode: "real", adapters: [adapter] }),
    );
  });

  it("申請がレジストリに到達していれば、応答タイムアウトでも 202 + pending 行", async () => {
    const authCode = seedForeignDomain(adapter, "slowmove.com");

    adapter.timeoutMode = "after-success";
    const res = await sendJson("/transfers", {
      name: "slowmove.com",
      authCode,
    });
    expect(res.status).toBe(202);

    const rows = await selectTransfers();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "pending",
      domainName: "slowmove.com",
    });
  });

  it("受理を確認できないタイムアウトは 504 のまま、追跡用の pending 行だけ残す", async () => {
    const authCode = seedForeignDomain(adapter, "lostmove.com");

    adapter.timeoutMode = "before-reach";
    const res = await sendJson("/transfers", {
      name: "lostmove.com",
      authCode,
    });
    expect(res.status).toBe(504);
    expect((await parseError(res)).error.code).toBe("REGISTRY_TIMEOUT");

    // transferQuery は「届いていない」と「届いたが完了した」を区別できないため（ADR-0002）、
    // 行を残して次回の一覧照合で拾えるようにする
    const rows = await selectTransfers();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("pending");
    expect(rows[0]?.raw).toMatchObject({ reconcile: "timeout_unconfirmed" });
  });
});

describe("GET /api/v1/transfers（FR-12 一覧と承認検知）", () => {
  it("AC-12-3: 相手が承認するとドメインが取り込まれ、保有一覧に出る", async () => {
    const authCode = seedForeignDomain(kitaqsign, "gained.com");
    const [created] = await requestTransfer("gained.com", authCode);

    // 相手レジストラ（またはサーバの自動承認）が承認した状態を作る
    kitaqsign.simulateCounterpartApprove("gained.com");

    const list = await listTransfers();
    expect(list.inbound).toEqual([]);
    expect(list.history).toHaveLength(1);
    const summary = list.history[0];
    expect(summary).toMatchObject({
      id: created?.id,
      domainName: "gained.com",
      direction: "in",
      status: "approved",
    });
    expect(summary?.domainId).not.toBeNull();
    expect(summary?.completedAt).not.toBeNull();

    // domains 行が作られ、last_transfer_at が入る（§6.5 / §9.2）
    const domains = await listDomains();
    expect(domains.map((d) => d.name)).toEqual(["gained.com"]);
    const [domainRow] = await db
      .select()
      .from(schema.domains)
      .where(eq(schema.domains.name, "gained.com"));
    expect(domainRow?.id).toBe(summary?.domainId);
    expect(domainRow?.userId).toBe(self.user.id);
    expect(domainRow?.lastTransferAt).not.toBeNull();
  });

  it("相手の拒否は Poll で検知して history に rejected として残る（#58）", async () => {
    const authCode = seedForeignDomain(kitaqsign, "rejected.com");
    await requestTransfer("rejected.com", authCode);

    kitaqsign.simulateCounterpartReject("rejected.com");

    const list = await listTransfers();
    expect(list.inbound).toEqual([]);
    expect(list.history).toHaveLength(1);
    expect(list.history[0]).toMatchObject({
      domainName: "rejected.com",
      direction: "in",
      status: "rejected",
      domainId: null,
    });
    expect(list.history[0]?.completedAt).not.toBeNull();
    // 拒否なので取り込まない
    expect(await listDomains()).toEqual([]);
  });

  it("Poll が届かない間は、pendingTransfer が消えても approved にはしない（承認と区別できないため据え置く）", async () => {
    const adapter = new NoPollAdapter({ id: "kitaqsign" });
    setRegistrySetForTesting(
      createRegistrySet({ mode: "real", adapters: [adapter] }),
    );
    const authCode = seedForeignDomain(adapter, "silent.com");
    await requestTransfer("silent.com", authCode);

    adapter.simulateCounterpartReject("silent.com");

    const list = await listTransfers();
    expect(list.history).toEqual([]);
    expect(list.inbound).toHaveLength(1);
    expect(list.inbound[0]?.status).toBe("pending");
    // 誤って取り込んでいない
    expect(await listDomains()).toEqual([]);
  });

  it("照合しても申請時に分かっていた値（act_by_at / 相手レジストラ）を null で潰さない", async () => {
    const authCode = seedForeignDomain(kitaqsign, "keep.com");
    const [before] = await requestTransfer("keep.com", authCode);

    await listTransfers();

    const [after] = await selectTransfers();
    expect(after?.actByAt?.toISOString()).toBe(before?.actByAt?.toISOString());
    expect(after?.counterpartRegistrarId).toBe("MOCK-FOREIGN");
    expect(after?.requestedAt?.toISOString()).toBe(
      before?.requestedAt?.toISOString(),
    );
  });

  it("§6.5: 取り込みに失敗しても approved のまま残り、次回の表示で再試行される", async () => {
    // 他ユーザーが同名の保有行を持っている状態を作る（承認の検知は info からの推定なので、
    // 推定を根拠に他人の保有行を奪ってはいけない）
    await db.insert(schema.domains).values({
      userId: other.user.id,
      name: "contested.com",
      sld: "contested",
      tld: "com",
      registry: "kitaqsign",
      ownership: "owned",
      statuses: ["ok"],
    });

    const authCode = seedForeignDomain(kitaqsign, "contested.com");
    await requestTransfer("contested.com", authCode);
    kitaqsign.simulateCounterpartApprove("contested.com");

    const blocked = await listTransfers();
    expect(blocked.inbound).toHaveLength(1);
    expect(blocked.inbound[0]).toMatchObject({
      status: "approved",
      domainId: null,
    });
    expect(findLogLine(consoleWarn, "transfer_import_conflict")).toMatchObject({
      domain: "contested.com",
    });
    // 他ユーザーの保有行は書き換えられていない
    const [contested] = await db
      .select()
      .from(schema.domains)
      .where(eq(schema.domains.name, "contested.com"));
    expect(contested?.userId).toBe(other.user.id);
    expect(await listDomains()).toEqual([]);

    // 衝突が解消すれば次の表示で取り込まれる
    await db
      .delete(schema.domains)
      .where(eq(schema.domains.name, "contested.com"));
    const retried = await listTransfers();
    expect(retried.history).toHaveLength(1);
    expect(retried.history[0]?.domainId).not.toBeNull();
    expect((await listDomains()).map((d) => d.name)).toEqual(["contested.com"]);
  });

  it("1 つのレジストリが落ちても一覧は返り、失敗した行は据え置かれる（部分失敗）", async () => {
    const signCode = seedForeignDomain(kitaqsign, "up.com");
    const nicCode = seedForeignDomain(kitaqnic, "down.xyz");
    await requestTransfer("up.com", signCode);
    await requestTransfer("down.xyz", nicCode);
    kitaqsign.simulateCounterpartApprove("up.com");

    kitaqnic.setFailMode("5xx");
    const list = await listTransfers();

    // 落ちている側は照合前の pending のまま、生きている側は取り込みまで進む
    expect(list.inbound.map((t) => t.domainName)).toEqual(["down.xyz"]);
    expect(list.history.map((t) => t.domainName)).toEqual(["up.com"]);
    expect(findLogLine(consoleWarn, "transfer_reconcile_failed")).toMatchObject(
      {
        domain: "down.xyz",
        registry: "kitaqnic",
        code: "REGISTRY_UNAVAILABLE",
      },
    );
  });

  it("レジストリからドメインが消えていても一覧は 200 で、その行は pending のまま", async () => {
    const authCode = seedForeignDomain(kitaqsign, "vanished.com");
    await requestTransfer("vanished.com", authCode);
    // 照合が NOT_FOUND になる状況（レジストリからドメインが消えた）を、
    // そのドメインを持たないアダプタに差し替えて再現する
    setRegistrySetForTesting(
      createRegistrySet({
        mode: "real",
        adapters: [new MockRegistryAdapter({ id: "kitaqsign" })],
      }),
    );

    const list = await listTransfers();
    expect(list.inbound).toHaveLength(1);
    expect(list.inbound[0]?.status).toBe("pending");
    expect(findLogLine(consoleWarn, "transfer_reconcile_failed")).toMatchObject(
      {
        code: "NOT_FOUND",
      },
    );
  });

  it("AC-02-1: 他ユーザーの移管は自分の一覧に出ない", async () => {
    const authCode = seedForeignDomain(kitaqsign, "mine.com");
    await requestTransfer("mine.com", authCode);

    const list = await listTransfers(other.cookie);
    expect(list).toEqual({ inbound: [], outbound: [], history: [] });
  });

  it("Poll 未実装のため outbound は常に空（#58）", async () => {
    const authCode = seedForeignDomain(kitaqsign, "onlyin.com");
    await requestTransfer("onlyin.com", authCode);
    const list = await listTransfers();
    expect(list.outbound).toEqual([]);
    expect(
      await db.$count(schema.transfers, eq(schema.transfers.direction, "out")),
    ).toBe(0);
  });

  it("FR-18: レジストリの生応答（raw）はどの応答にも含めない", async () => {
    const authCode = seedForeignDomain(kitaqsign, "noraw.com");
    const created = await sendJson("/transfers", {
      name: "noraw.com",
      authCode,
    });
    expect(created.status).toBe(202);
    // 値ではなくキーの有無で見る（mock の raw は無害な値なので値比較では検知できない）
    expect(await created.text()).not.toContain('"raw"');

    const [row] = await selectTransfers();
    expect(await (await api("/transfers")).text()).not.toContain('"raw"');
    expect(await (await api(`/transfers/${row?.id}`)).text()).not.toContain(
      '"raw"',
    );
    // DB には残している（障害調査・契約テストの fixture 用。§9.1）
    expect(row?.raw).not.toBeNull();
  });
});

describe("承認検知の境界（#56 / ADR-0002）", () => {
  /**
   * 時計を動かせる mock。過去の移管履歴（trDate）を作るのに使う。
   * ここで確かめたいのは Poll が無いときの `info` からの承認検知なので、
   * 通知を返さないアダプタにする（Poll があれば確定は通知が運んでくる）。
   */
  function clockedAdapter(now: () => Date): MockRegistryAdapter {
    const adapter = new NoPollAdapter({ id: "kitaqsign", now });
    setRegistrySetForTesting(
      createRegistrySet({ mode: "real", adapters: [adapter] }),
    );
    return adapter;
  }

  it("申請より前の移管履歴（古い trDate）を自分の承認と取り違えない", async () => {
    let clock = new Date("2026-01-01T00:00:00.000Z");
    const adapter = clockedAdapter(() => clock);
    // このドメインには過去（申請より前）の移管履歴がある
    const code = await seedForeignDomainWithPastTransfer(adapter, "old.com");

    clock = new Date("2026-06-01T00:00:00.000Z");
    await requestTransfer("old.com", code);
    // 相手が拒否 → pendingTransfer は消えるが trDate は古いまま
    adapter.simulateCounterpartReject("old.com");

    const list = await listTransfers();
    expect(list.history).toEqual([]);
    expect(list.inbound[0]?.status).toBe("pending");
    expect(await listDomains()).toEqual([]);
  });

  it("自動承認期限を大きく過ぎた移管（無関係な後日の移管）を自分の承認にしない", async () => {
    let clock = new Date("2026-06-01T00:00:00.000Z");
    const adapter = clockedAdapter(() => clock);
    const authCode = seedForeignDomain(adapter, "later.com");
    await requestTransfer("later.com", authCode);
    // 自分の申請は拒否された（検知できないので行は pending のまま残る）
    adapter.simulateCounterpartReject("later.com");

    // 10 日後、この申請とは無関係な移管が成立して trDate だけが進む
    clock = new Date("2026-06-11T00:00:00.000Z");
    await adapter.transferRequest("later.com", authCode);
    adapter.simulateCounterpartApprove("later.com");

    const list = await listTransfers();
    // 申請 + 20 分の自動承認期限を大きく過ぎた trDate は自分の申請の結果ではない
    expect(list.history).toEqual([]);
    expect(list.inbound[0]?.status).toBe("pending");
    expect(await listDomains()).toEqual([]);
  });

  it("Poll が届かなくても、期限内の trDate なら承認として取り込む", async () => {
    const clock = new Date("2026-06-01T00:00:00.000Z");
    const adapter = clockedAdapter(() => clock);
    const authCode = seedForeignDomain(adapter, "quiet.com");
    await requestTransfer("quiet.com", authCode);
    // 相手が承認したが通知は届かない。pendingTransfer が消えて trDate だけが進む
    adapter.simulateCounterpartApprove("quiet.com");

    const list = await listTransfers();
    expect(list.history).toHaveLength(1);
    expect(list.history[0]).toMatchObject({ status: "approved" });
    expect(list.history[0]?.domainId).not.toBeNull();
    expect((await listDomains()).map((d) => d.name)).toEqual(["quiet.com"]);
  });

  it("応答待ちの間に成立した移管を、タイムアウト行から拾える（ADR-0002 の宿題）", async () => {
    // 申請はレジストリに届いて即座に成立したが、応答が返らずタイムアウトした状況
    class CompletedThenTimeoutAdapter extends NoPollAdapter {
      override async transferRequest(
        name: string,
        authCode: string,
      ): Promise<TransferResult> {
        await super.transferRequest(name, authCode);
        // 相手（losing）側が即座に承認した
        this.simulateCounterpartApprove(name);
        // 成立してから応答を諦めるまでに時間が経つ（実際は更新系 15 秒のタイムアウト）。
        // この間があるので、requested_at に「照合が終わった今」を使うと trDate を追い越す。
        await new Promise((resolve) => setTimeout(resolve, 30));
        throw new RegistryError({
          code: "REGISTRY_TIMEOUT",
          registry: this.id,
          message: "transfer:request: 応答がありません（テスト）",
        });
      }
    }
    const adapter = new CompletedThenTimeoutAdapter({ id: "kitaqsign" });
    setRegistrySetForTesting(
      createRegistrySet({ mode: "real", adapters: [adapter] }),
    );
    const authCode = seedForeignDomain(adapter, "raced.com");

    const res = await sendJson("/transfers", { name: "raced.com", authCode });
    // 受理を確認できないので 504 のままだが、追跡用の行は残る
    expect(res.status).toBe(504);
    const [row] = await selectTransfers();
    expect(row?.raw).toMatchObject({ reconcile: "timeout_unconfirmed" });

    // requested_at は「送り始めた時刻」なので、待っている間に付いた trDate を拾える
    const list = await listTransfers();
    expect(list.history).toHaveLength(1);
    expect(list.history[0]).toMatchObject({ status: "approved" });
    expect(list.history[0]?.domainId).not.toBeNull();
    expect((await listDomains()).map((d) => d.name)).toEqual(["raced.com"]);
  });
});

describe("取り込み再試行の期限（§6.5）", () => {
  /** 承認・取り込みまで進めてから domains 行を消し、取り込み待ちの状態を作る。 */
  async function makeImportPending(name: string): Promise<string> {
    const authCode = seedForeignDomain(kitaqsign, name);
    await requestTransfer(name, authCode);
    kitaqsign.simulateCounterpartApprove(name);
    await listTransfers();
    // FR-10 の廃止や FR-16 のデモリセットで domains 行が消えると
    // FK（ON DELETE SET NULL）で domain_id が null に戻る
    await db.delete(schema.domains).where(eq(schema.domains.name, name));
    const [row] = await selectTransfers();
    expect(row?.domainId).toBeNull();
    return row?.id ?? "";
  }

  it("検知から間もない行は一覧を開くだけで再試行される", async () => {
    await makeImportPending("recent.com");

    const list = await listTransfers();
    expect(list.history[0]?.domainId).not.toBeNull();
  });

  it("検知から 24 時間を過ぎた行は一覧では再試行せず、単票なら再試行する", async () => {
    const id = await makeImportPending("stale.com");
    // 承認を検知した時刻（raw.checkedAt）を 3 日前にする
    await db
      .update(schema.transfers)
      .set({ raw: { checkedAt: "2026-08-23T00:00:00.000Z" } })
      .where(eq(schema.transfers.id, id));

    const list = await listTransfers();
    expect(list.inbound[0]?.domainId).toBeNull();
    expect(await listDomains()).toEqual([]);

    // ユーザーが明示的に叩く導線（S-50 の再試行）は期限を掛けない
    const res = await api(`/transfers/${id}`);
    const { transfer } = transferDetailResponseSchema.parse(await res.json());
    expect(transfer.domainId).not.toBeNull();
    expect((await listDomains()).map((d) => d.name)).toEqual(["stale.com"]);
  });
});

describe("AC-12-5: 同名を再び移管 IN しても DB 制約で失敗しない", () => {
  it("移管 OUT 済みの履歴行が残っていても取り込めて、保有一覧には新しい行だけ出る", async () => {
    // 過去に移管 OUT したドメインの履歴行（§9.1 の部分一意インデックスで同名を許す）
    await db.insert(schema.domains).values({
      userId: self.user.id,
      name: "again.com",
      sld: "again",
      tld: "com",
      registry: "kitaqsign",
      ownership: "transferred_out",
      statuses: ["ok"],
    });

    const authCode = seedForeignDomain(kitaqsign, "again.com");
    await requestTransfer("again.com", authCode);
    kitaqsign.simulateCounterpartApprove("again.com");

    const list = await listTransfers();
    expect(list.history[0]?.domainId).not.toBeNull();
    // 履歴行は残したまま、保有一覧には owned の 1 行だけが出る（FR-02 / AC-02-4）
    expect((await listDomains()).map((d) => d.name)).toEqual(["again.com"]);
    const rows = await db
      .select()
      .from(schema.domains)
      .where(eq(schema.domains.name, "again.com"));
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.ownership === "owned")).toHaveLength(1);
  });
});

describe("GET /api/v1/transfers/:id（FR-12 状態照会）", () => {
  it("自分の移管を 1 件返す", async () => {
    const authCode = seedForeignDomain(kitaqsign, "one.com");
    const [created] = await requestTransfer("one.com", authCode);

    const res = await api(`/transfers/${created?.id}`);
    expect(res.status).toBe(200);
    const { transfer } = transferDetailResponseSchema.parse(await res.json());
    expect(transfer).toMatchObject({
      id: created?.id,
      domainName: "one.com",
      direction: "in",
      status: "pending",
      domainId: null,
    });
  });

  it("AC-12-3: 単票でも承認検知 → 取り込み → domain_id 紐付けまで進む", async () => {
    const authCode = seedForeignDomain(kitaqsign, "single.com");
    const [created] = await requestTransfer("single.com", authCode);
    kitaqsign.simulateCounterpartApprove("single.com");

    const res = await api(`/transfers/${created?.id}`);
    const { transfer } = transferDetailResponseSchema.parse(await res.json());
    expect(transfer.status).toBe("approved");
    expect(transfer.domainId).not.toBeNull();
    expect((await listDomains()).map((d) => d.name)).toEqual(["single.com"]);
  });

  it("他ユーザーの移管は 403 FORBIDDEN", async () => {
    const authCode = seedForeignDomain(kitaqsign, "notyours.com");
    const [created] = await requestTransfer("notyours.com", authCode);

    const res = await api(`/transfers/${created?.id}`, {
      cookie: other.cookie,
    });
    expect(res.status).toBe(403);
    expect((await parseError(res)).error.code).toBe("FORBIDDEN");
  });

  it("存在しない uuid は 404 NOT_FOUND", async () => {
    const res = await api("/transfers/11111111-1111-4111-8111-111111111111");
    expect(res.status).toBe(404);
    expect((await parseError(res)).error.code).toBe("NOT_FOUND");
  });

  it.each(["move.com", "-bad.com", "123"])(
    "uuid でない %s は 400 VALIDATION_ERROR",
    async (id) => {
      const res = await api(`/transfers/${id}`);
      expect(res.status).toBe(400);
      expect((await parseError(res)).error.code).toBe("VALIDATION_ERROR");
    },
  );
});

describe("AC-01-3: 移管ルートの認証", () => {
  it.each([
    ["POST", "/api/v1/transfers"],
    ["GET", "/api/v1/transfers"],
    ["GET", "/api/v1/transfers/11111111-1111-4111-8111-111111111111"],
  ])("%s %s は Cookie 無しで 401 UNAUTHORIZED", async (method, path) => {
    const res = await app.request(path, { method });
    expect(res.status).toBe(401);
    expect((await parseError(res)).error.code).toBe("UNAUTHORIZED");
  });

  it("無効なセッション ID でも 401", async () => {
    const res = await app.request("/api/v1/transfers", {
      headers: { cookie: "dopamin_session=not-a-real-session" },
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/v1/transfers/:id/approve・reject（FR-12 移管 OUT。#57）", () => {
  it("AC-12-4 / AC-12-5: 承認すると approved になり、保有一覧から消えて操作もできなくなる", async () => {
    const id = await receiveInboundRequest("giveaway.com");

    const approved = await api(`/transfers/${id}/approve`, { method: "POST" });
    expect(approved.status).toBe(200);
    const { transfer } = transferDetailResponseSchema.parse(
      await approved.json(),
    );
    expect(transfer).toMatchObject({
      id,
      domainName: "giveaway.com",
      direction: "out",
      status: "approved",
    });
    expect(transfer.completedAt).not.toBeNull();

    // AC-12-5: 保有一覧から消え、行は履歴として残る
    expect(await listDomains()).toEqual([]);
    const [row] = await db
      .select()
      .from(schema.domains)
      .where(eq(schema.domains.name, "giveaway.com"));
    expect(row?.ownership).toBe("transferred_out");
    expect(row?.transferredOutAt).not.toBeNull();

    // AC-12-5: 以後その行への書き込み系操作は OPERATION_NOT_ALLOWED
    const patched = await sendJson(
      "/domains/giveaway.com",
      { nameservers: [] },
      { method: "PATCH" },
    );
    expect(patched.status).toBe(409);
    expect((await parseError(patched)).error.code).toBe(
      "OPERATION_NOT_ALLOWED",
    );

    // 一覧では履歴に落ちる
    const list = await listTransfers();
    expect(list.outbound).toEqual([]);
    expect(list.history.map((t) => t.status)).toEqual(["approved"]);
  });

  it("AC-12-4: 拒否すると rejected になり、ドメインは自分の保有のまま", async () => {
    const id = await receiveInboundRequest("keepit.com");

    const res = await api(`/transfers/${id}/reject`, { method: "POST" });
    expect(res.status).toBe(200);
    const { transfer } = transferDetailResponseSchema.parse(await res.json());
    expect(transfer).toMatchObject({ status: "rejected", direction: "out" });

    expect((await listDomains()).map((d) => d.name)).toEqual(["keepit.com"]);
    // レジストリ側の申請も消えている
    expect((await kitaqsign.info("keepit.com")).statuses).not.toContain(
      "pendingTransfer",
    );
  });

  it("承認済みの行にもう一度操作すると 409 OPERATION_NOT_ALLOWED", async () => {
    const id = await receiveInboundRequest("twicehit.com");
    expect(
      (await api(`/transfers/${id}/approve`, { method: "POST" })).status,
    ).toBe(200);

    const again = await api(`/transfers/${id}/reject`, { method: "POST" });
    expect(again.status).toBe(409);
    expect((await parseError(again)).error.code).toBe("OPERATION_NOT_ALLOWED");
  });

  it("移管 IN の行を承認・拒否しようとすると 409 OPERATION_NOT_ALLOWED", async () => {
    const authCode = seedForeignDomain(kitaqsign, "notmine.com");
    const [row] = await requestTransfer("notmine.com", authCode);

    for (const action of ["approve", "reject"]) {
      const res = await api(`/transfers/${row?.id}/${action}`, {
        method: "POST",
      });
      expect(res.status).toBe(409);
      expect((await parseError(res)).error.code).toBe("OPERATION_NOT_ALLOWED");
    }
    // 行は pending のまま
    const [after] = await selectTransfers();
    expect(after?.status).toBe("pending");
  });

  it("他ユーザーの移管は 403 FORBIDDEN で、レジストリも叩かない", async () => {
    const id = await receiveInboundRequest("notyours-out.com");

    const res = await api(`/transfers/${id}/approve`, {
      method: "POST",
      cookie: other.cookie,
    });
    expect(res.status).toBe(403);
    expect((await parseError(res)).error.code).toBe("FORBIDDEN");
    expect((await kitaqsign.info("notyours-out.com")).statuses).toContain(
      "pendingTransfer",
    );
  });
});

describe("POST /api/v1/transfers/:id/cancel（FR-12 移管 IN の取消。#57）", () => {
  it("承認前の自分の申請を取り消すと cancelled になり、レジストリの申請も消える", async () => {
    const authCode = seedForeignDomain(kitaqsign, "givingup.com");
    const [row] = await requestTransfer("givingup.com", authCode);

    const res = await api(`/transfers/${row?.id}/cancel`, { method: "POST" });
    expect(res.status).toBe(200);
    const { transfer } = transferDetailResponseSchema.parse(await res.json());
    expect(transfer).toMatchObject({ status: "cancelled", direction: "in" });
    expect(transfer.completedAt).not.toBeNull();

    expect((await kitaqsign.info("givingup.com")).statuses).not.toContain(
      "pendingTransfer",
    );
    // 取消なので取り込まない
    expect(await listDomains()).toEqual([]);
    const list = await listTransfers();
    expect(list.inbound).toEqual([]);
    expect(list.history.map((t) => t.status)).toEqual(["cancelled"]);
  });

  it("移管 OUT の行を取り消そうとすると 409 OPERATION_NOT_ALLOWED", async () => {
    const id = await receiveInboundRequest("cantcancel.com");

    const res = await api(`/transfers/${id}/cancel`, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await parseError(res)).error.code).toBe("OPERATION_NOT_ALLOWED");
  });
});

describe("AC-01-3 / §10.3: 移管操作ルートの認証とパラメータ", () => {
  const uuid = "11111111-1111-4111-8111-111111111111";

  it.each(["approve", "reject", "cancel"])(
    "POST /transfers/:id/%s は Cookie 無しで 401 UNAUTHORIZED",
    async (action) => {
      const res = await app.request(`/api/v1/transfers/${uuid}/${action}`, {
        method: "POST",
      });
      expect(res.status).toBe(401);
      expect((await parseError(res)).error.code).toBe("UNAUTHORIZED");
    },
  );

  it.each(["approve", "reject", "cancel"])(
    "uuid でない :id の %s は 400 VALIDATION_ERROR",
    async (action) => {
      const res = await api(`/transfers/move.com/${action}`, {
        method: "POST",
      });
      expect(res.status).toBe(400);
      expect((await parseError(res)).error.code).toBe("VALIDATION_ERROR");
    },
  );

  it.each(["approve", "reject", "cancel"])(
    "存在しない移管の %s は 404 NOT_FOUND",
    async (action) => {
      const res = await api(`/transfers/${uuid}/${action}`, { method: "POST" });
      expect(res.status).toBe(404);
      expect((await parseError(res)).error.code).toBe("NOT_FOUND");
    },
  );
});
