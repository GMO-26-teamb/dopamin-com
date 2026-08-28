import { type Db, schema } from "@dopamin/db";
import { createRegistrySet, MockRegistryAdapter } from "@dopamin/registry";
import {
  type TransferSummary,
  type TransfersListResponse,
  transfersListResponseSchema,
} from "@dopamin/shared";
import { asc, eq } from "drizzle-orm";
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
import { getDomainStore } from "../../src/services/domain-store";
import { createTestDb, resetTestDb } from "../helpers/db";
import { createTestSession } from "../helpers/session";

/**
 * FR-12 の移管 7 ケース統合テスト（§19 / AC-12-1〜5）。
 *
 * ルートの単体的な検証は `transfers.test.ts`（インメモリのストア）が持つ。
 * こちらは **本物の DB（pglite + 実マイグレーション）** を通し、
 * `transfers.status` / `domains.ownership` / 一覧の可視性が
 * 1 本のシナリオを通して整合することを確かめる。
 * 特に「出戻り」（移管 OUT 後に同名を再取得）は `domains_name_owned_uniq` が
 * 部分一意インデックスであることに依存するので、実 DDL でしか検証できない。
 */

let db: Db;
let closeDb: () => Promise<void>;
let kitaqsign: MockRegistryAdapter;
let cookie: string;
let userId: string;

/** 移管 5 操作を持つ mock を配線する。`autoApproveMs: 0` でサーバ自動承認を即時化できる。 */
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

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
  setDbForTesting(db);
}, 30_000);

afterAll(async () => {
  setDbForTesting(null);
  await closeDb();
});

beforeEach(async () => {
  // 参照系の自動再試行（#60）のバックオフでテストが待たされないようにする
  setRetrySleepForTesting(() => Promise.resolve());

  await resetTestDb(db);
  setDbForTesting(db);
  installRegistry();
  const session = await createTestSession(db);
  cookie = session.cookie;
  userId = session.user.id;
  // 構造化ログでテスト出力を汚さない
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  setRetrySleepForTesting(null);

  setRegistrySetForTesting(null);
  vi.restoreAllMocks();
});

async function api(path: string, init?: RequestInit): Promise<Response> {
  return app.request(`/api/v1${path}`, {
    ...init,
    headers: { cookie, ...init?.headers },
  });
}

function sendJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function listTransfers(): Promise<TransfersListResponse> {
  const res = await api("/transfers");
  expect(res.status).toBe(200);
  return transfersListResponseSchema.parse(await res.json());
}

/** 保有一覧（FR-02）に見えているドメイン名。 */
async function visibleDomains(): Promise<string[]> {
  const res = await api("/domains");
  expect(res.status).toBe(200);
  const { domains } = (await res.json()) as { domains: { name: string }[] };
  return domains.map((d) => d.name);
}

/** `domains` の行を作成順に取り出す（履歴行が残ることの確認用）。 */
async function domainRows(name: string) {
  return db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.name, name))
    .orderBy(asc(schema.domains.createdAt));
}

async function transferRows(name: string) {
  return db
    .select()
    .from(schema.transfers)
    .where(eq(schema.transfers.domainName, name))
    .orderBy(asc(schema.transfers.createdAt));
}

/** 相手レジストラ保有のドメインを投入し、移管 IN 用の AuthCode を返す。 */
function seedForeign(name: string): string {
  const authCode = `foreign-auth-${name}`;
  kitaqsign.seedForeignDomain(name, authCode);
  return authCode;
}

/** 移管 IN を申請して `transfers` 行の ID を返す。 */
async function requestInbound(name: string, authCode: string): Promise<string> {
  const res = await sendJson("/transfers", { name, authCode });
  expect(res.status).toBe(202);
  const { record } = (await res.json()) as { record: TransferSummary };
  return record.id;
}

/** 自分のドメインを登録し、移管 OUT 用の AuthCode を返す。 */
async function createOwnDomain(name: string): Promise<string> {
  expect((await sendJson("/domains", { name, period: 1 })).status).toBe(201);
  const res = await api(`/domains/${name}/auth-code`, { method: "POST" });
  expect(res.status).toBe(200);
  return ((await res.json()) as { authCode: string }).authCode;
}

/** 相手からの申請を受信し、Poll を消化して `transfers(out)` の ID を返す。 */
async function receiveOutbound(name: string): Promise<string> {
  kitaqsign.simulateInboundTransferRequest(name);
  expect((await api("/registry/poll", { method: "POST" })).status).toBe(200);
  const rows = await transferRows(name);
  const pending = rows.find(
    (r) => r.direction === "out" && r.status === "pending",
  );
  if (!pending) {
    throw new Error(`${name} の OUT 行が Poll 消化で作られていない`);
  }
  return pending.id;
}

describe("1. 移管 IN 承認（AC-12-1 / AC-12-3）", () => {
  it("申請 → 相手の承認 → 取り込みで保有一覧に出る", async () => {
    const authCode = seedForeign("in-ok.com");
    const id = await requestInbound("in-ok.com", authCode);

    // 申請中は保有一覧に出ず、移管一覧に pending として出る
    expect(await visibleDomains()).toEqual([]);
    expect((await listTransfers()).inbound.map((t) => t.id)).toEqual([id]);
    expect(await domainRows("in-ok.com")).toHaveLength(0);

    kitaqsign.simulateCounterpartApprove("in-ok.com");
    const list = await listTransfers();

    expect(list.inbound).toEqual([]);
    expect(list.history).toHaveLength(1);
    expect(list.history[0]).toMatchObject({ id, status: "approved" });
    expect(list.history[0]?.domainId).not.toBeNull();

    const domains = await domainRows("in-ok.com");
    expect(domains).toHaveLength(1);
    expect(domains[0]).toMatchObject({ userId, ownership: "owned" });
    // 取り込みで last_transfer_at が入る（§6.5）
    expect(domains[0]?.lastTransferAt).not.toBeNull();
    expect(await visibleDomains()).toEqual(["in-ok.com"]);

    const transfers = await transferRows("in-ok.com");
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({
      direction: "in",
      status: "approved",
      domainId: domains[0]?.id,
    });
    expect(transfers[0]?.completedAt).not.toBeNull();
  });
});

describe("2. 移管 IN 拒否（AC-12-2 の相手側）", () => {
  it("相手が拒否すると rejected で履歴に残り、ドメインは取り込まれない", async () => {
    const authCode = seedForeign("in-ng.com");
    const id = await requestInbound("in-ng.com", authCode);

    kitaqsign.simulateCounterpartReject("in-ng.com");
    const list = await listTransfers();

    expect(list.inbound).toEqual([]);
    expect(list.history[0]).toMatchObject({ id, status: "rejected" });
    expect(list.history[0]?.domainId).toBeNull();
    expect(await domainRows("in-ng.com")).toHaveLength(0);
    expect(await visibleDomains()).toEqual([]);
  });
});

describe("3. 移管 IN 取消（P1）", () => {
  it("承認前に取り消すと cancelled になり、レジストリの申請も消える", async () => {
    const authCode = seedForeign("in-cancel.com");
    const id = await requestInbound("in-cancel.com", authCode);

    const res = await api(`/transfers/${id}/cancel`, { method: "POST" });
    expect(res.status).toBe(200);

    expect((await kitaqsign.info("in-cancel.com")).statuses).not.toContain(
      "pendingTransfer",
    );
    const list = await listTransfers();
    expect(list.inbound).toEqual([]);
    expect(list.history[0]).toMatchObject({ id, status: "cancelled" });
    expect(await domainRows("in-cancel.com")).toHaveLength(0);
    expect(await visibleDomains()).toEqual([]);
  });
});

describe("4. 移管 OUT 承認（AC-12-4 / AC-12-5）", () => {
  it("受信 → 承認で保有一覧から消え、行は履歴として残る", async () => {
    await createOwnDomain("out-ok.com");
    const id = await receiveOutbound("out-ok.com");

    expect((await listTransfers()).outbound.map((t) => t.id)).toEqual([id]);
    expect(await visibleDomains()).toEqual(["out-ok.com"]);

    const res = await api(`/transfers/${id}/approve`, { method: "POST" });
    expect(res.status).toBe(200);

    // レジストリ側でもスポンサーが移っている（現スポンサーしか AuthCode を再発行できない）
    await expect(kitaqsign.authCode("out-ok.com")).rejects.toMatchObject({
      registryCode: 2201,
    });

    expect(await visibleDomains()).toEqual([]);
    const domains = await domainRows("out-ok.com");
    expect(domains).toHaveLength(1);
    expect(domains[0]).toMatchObject({ ownership: "transferred_out" });
    expect(domains[0]?.transferredOutAt).not.toBeNull();

    const list = await listTransfers();
    expect(list.outbound).toEqual([]);
    expect(list.history[0]).toMatchObject({
      id,
      direction: "out",
      status: "approved",
    });
  });
});

describe("5. 移管 OUT 拒否（AC-12-4）", () => {
  it("拒否すると保有は動かず、履歴に rejected で残る", async () => {
    await createOwnDomain("out-ng.com");
    const id = await receiveOutbound("out-ng.com");

    const res = await api(`/transfers/${id}/reject`, { method: "POST" });
    expect(res.status).toBe(200);

    // スポンサーは自分のまま（AuthCode を再発行できる）
    await expect(kitaqsign.authCode("out-ng.com")).resolves.toBeTruthy();
    expect(await visibleDomains()).toEqual(["out-ng.com"]);
    expect((await domainRows("out-ng.com"))[0]).toMatchObject({
      ownership: "owned",
      transferredOutAt: null,
    });

    const list = await listTransfers();
    expect(list.outbound).toEqual([]);
    expect(list.history[0]).toMatchObject({ id, status: "rejected" });
  });
});

describe("6. 移管 OUT のサーバ自動承認（FR-12 / AC-02-4）", () => {
  it("放置した申請は期限到来で自動承認され、最新化で一覧から消える", async () => {
    // 期限を 0 にして「放置されたまま期限が来た」状態を作る（§11.1 の遅延評価）
    installRegistry({ autoApproveMs: 0 });
    await createOwnDomain("out-auto.com");
    kitaqsign.simulateInboundTransferRequest("out-auto.com");

    const res = await api("/domains/sync", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { domains: { name: string }[] };

    // AC-02-4: 最新化の応答時点で保有一覧から消えている
    expect(body.domains.map((d) => d.name)).toEqual([]);
    expect(await visibleDomains()).toEqual([]);
    expect((await domainRows("out-auto.com"))[0]).toMatchObject({
      ownership: "transferred_out",
    });

    const list = await listTransfers();
    expect(list.outbound).toEqual([]);
    expect(list.history[0]).toMatchObject({
      direction: "out",
      status: "approved",
    });
  });
});

describe("7. 出戻り（移管 OUT 後に同名を再取得）", () => {
  it("移管 OUT 済みの行を残したまま再び移管 IN できる（部分一意インデックス）", async () => {
    const authCode = await createOwnDomain("boomerang.com");
    const outId = await receiveOutbound("boomerang.com");
    expect(
      (await api(`/transfers/${outId}/approve`, { method: "POST" })).status,
    ).toBe(200);
    expect(await visibleDomains()).toEqual([]);

    // 相手レジストラ保有になったので、同じ AuthCode で取り戻せる
    const inId = await requestInbound("boomerang.com", authCode);
    kitaqsign.simulateCounterpartApprove("boomerang.com");
    const list = await listTransfers();

    // 一意制約違反にならず、保有中の行が新しく作られる（§9.1）
    const domains = await domainRows("boomerang.com");
    expect(domains).toHaveLength(2);
    expect(domains.map((d) => d.ownership)).toEqual([
      "transferred_out",
      "owned",
    ]);
    expect(await visibleDomains()).toEqual(["boomerang.com"]);

    // 移管の履歴は OUT / IN の 2 件とも残る
    expect(list.history).toHaveLength(2);
    const byId = new Map(list.history.map((t) => [t.id, t]));
    expect(byId.get(outId)).toMatchObject({
      direction: "out",
      status: "approved",
    });
    expect(byId.get(inId)).toMatchObject({
      direction: "in",
      status: "approved",
    });
    // 新しい IN は新しい保有行に紐付く（古い履歴行ではない）
    expect(byId.get(inId)?.domainId).toBe(domains[1]?.id);
  });
});

describe("8. info 取得中の移管 OUT 確定（#251 / AC-12-5 / AC-02-4）", () => {
  /**
   * `info` の応答直後（= write-through の直前）に移管 OUT の確定を割り込ませる。
   *
   * S-32 の自動承認カウントダウンが 0 に達すると、詳細画面が `GET /domains/:name` と
   * `GET /transfers`（→ Poll 消化 → `markTransferredOut`）を同じ tick で投げるので、
   * この並びは実際に起こりうる。`info` の再試行（最大 5s × 3 回）の分だけ窓が広い。
   *
   * ここで保有行を作り直すと、`domains_name_owned_uniq` が `ownership = 'owned'` の
   * 部分一意インデックスであるせいで衝突が起きず、`transferred_out` 行の隣に
   * `owned` 行が生えて一覧に復活する（`sync` でも消えない）。
   */
  function interleaveTransferOutDuringInfo(name: string): void {
    const original = kitaqsign.info.bind(kitaqsign);
    let done = false;
    vi.spyOn(kitaqsign, "info").mockImplementation(async (target: string) => {
      const info = await original(target);
      if (!done && target === name) {
        done = true;
        await getDomainStore().markTransferredOut(target, new Date());
      }
      return info;
    });
  }

  it("詳細取得の write-through が保有行を復活させない", async () => {
    await createOwnDomain("race-detail.com");
    interleaveTransferOutDuringInfo("race-detail.com");

    const res = await api("/domains/race-detail.com");
    expect(res.status).toBe(200);

    const rows = await domainRows("race-detail.com");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ownership: "transferred_out" });
    expect(await visibleDomains()).toEqual([]);

    // 復旧経路が塞がっていないこと: 最新化しても行は増えず、一覧にも戻らない
    const sync = await api("/domains/sync", { method: "POST" });
    expect(sync.status).toBe(200);
    const body = (await sync.json()) as { domains: { name: string }[] };
    expect(body.domains.map((d) => d.name)).toEqual([]);
    expect(await domainRows("race-detail.com")).toHaveLength(1);
    expect(await visibleDomains()).toEqual([]);
  });

  it("最新化の write-through が保有行を復活させない", async () => {
    await createOwnDomain("race-sync.com");
    interleaveTransferOutDuringInfo("race-sync.com");

    const res = await api("/domains/sync", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      domains: { name: string }[];
      failures: unknown[];
    };

    // 書けなかったことは失敗ではない（移管 OUT が確定しただけ）
    expect(body.domains.map((d) => d.name)).toEqual([]);
    expect(body.failures).toEqual([]);
    const rows = await domainRows("race-sync.com");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ownership: "transferred_out" });
    expect(await visibleDomains()).toEqual([]);
  });

  it("読んだ後に別ユーザーが同名を取り直していたら 403（#222 / NFR-04）", async () => {
    await createOwnDomain("race-owner.com");

    // `info` の応答直後に「旧行の破棄 → 別ユーザーの新規登録」を割り込ませる。
    // 旧 `upsert` は setWhere が外れて 0 行 = FORBIDDEN で落ちていた経路なので、
    // write-through を UPDATE に変えた後も落ち続けること（他人の行を返さないこと）を固定する
    const other = await createTestSession(db);
    const original = kitaqsign.info.bind(kitaqsign);
    let done = false;
    vi.spyOn(kitaqsign, "info").mockImplementation(async (target: string) => {
      const info = await original(target);
      if (!done && target === "race-owner.com") {
        done = true;
        await getDomainStore().remove(target);
        await getDomainStore().upsert({
          userId: other.user.id,
          name: target,
          registry: info.registry,
          ownership: "owned",
          info,
          syncedAt: new Date(),
        });
      }
      return info;
    });

    const res = await api("/domains/race-owner.com");
    expect(res.status).toBe(403);

    // 他ユーザーの行を書き換えても増やしてもいない
    const rows = await domainRows("race-owner.com");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: other.user.id });
  });

  it("割り込みが無ければ従来どおり write-through する", async () => {
    await createOwnDomain("race-none.com");
    const before = (await domainRows("race-none.com"))[0];

    expect((await api("/domains/race-none.com")).status).toBe(200);

    const rows = await domainRows("race-none.com");
    expect(rows).toHaveLength(1);
    // 同じ行が更新される（id を保つ）。syncedAt が進む = 実際に書けている
    expect(rows[0]?.id).toBe(before?.id);
    expect(rows[0]).toMatchObject({ ownership: "owned", userId });
    expect(rows[0]?.syncedAt?.getTime()).toBeGreaterThanOrEqual(
      before?.syncedAt?.getTime() ?? 0,
    );
    expect(await visibleDomains()).toEqual(["race-none.com"]);
  });
});
