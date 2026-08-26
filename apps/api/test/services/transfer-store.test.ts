import { type Db, schema } from "@dopamin/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createDbTransferStore,
  createInMemoryTransferStore,
  type TransferInsert,
  type TransferStore,
} from "../../src/services/transfer-store";
import { createTestDb, resetTestDb } from "../helpers/db";

/**
 * `transfers` の永続化（§9.1 / FR-12）。
 *
 * ルートの統合テストはインメモリ実装を使うので、Drizzle 実装のクエリが実際に通ることは
 * pglite で確かめる。両実装を同じシナリオに通し、テスト用の seam が本番と挙動を
 * 揃えていることも同時に検証する。
 */

let db: Db;
let closeDb: () => Promise<void>;
let userId: string;
let otherUserId: string;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
}, 30_000);

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await resetTestDb(db);
  const rows = await db
    .insert(schema.users)
    .values([{ displayName: "移管テスト" }, { displayName: "別のユーザー" }])
    .returning({ id: schema.users.id });
  const [owner, other] = rows;
  if (owner === undefined || other === undefined) {
    throw new Error("users の INSERT に失敗した");
  }
  userId = owner.id;
  otherUserId = other.id;
});

function pendingInbound(
  overrides: Partial<TransferInsert> = {},
): TransferInsert {
  return {
    userId,
    domainId: null,
    domainName: "move.example",
    registry: "kitaqsign",
    direction: "in",
    status: "pending",
    registryStatus: "pending",
    counterpartRegistrarId: "REG-OTHER",
    registryMessageId: null,
    requestedAt: new Date("2026-08-26T00:00:00.000Z"),
    actByAt: new Date("2026-08-26T00:20:00.000Z"),
    completedAt: null,
    raw: { source: "test" },
    ...overrides,
  };
}

/** 両実装に同じシナリオを流す（インメモリ実装が本番から乖離しないための対照）。 */
const implementations: [string, () => TransferStore][] = [
  ["Drizzle（pglite）", () => createDbTransferStore(db)],
  ["インメモリ", () => createInMemoryTransferStore()],
];

describe.each(implementations)("TransferStore（%s）", (_label, create) => {
  it("create した行を findById で引ける", async () => {
    const store = create();
    const created = await store.create(pendingInbound());
    expect(created.id).toBeTruthy();

    const found = await store.findById(created.id);
    expect(found).toMatchObject({
      domainName: "move.example",
      registry: "kitaqsign",
      direction: "in",
      status: "pending",
      counterpartRegistrarId: "REG-OTHER",
      domainId: null,
    });
    expect(found?.requestedAt?.toISOString()).toBe("2026-08-26T00:00:00.000Z");
  });

  it("list はユーザーの行だけを返す（NFR-04）", async () => {
    const store = create();
    await store.create(pendingInbound());
    await store.create(
      pendingInbound({ userId: otherUserId, domainName: "other.example" }),
    );

    const rows = await store.list(userId);
    expect(rows.map((r) => r.domainName)).toEqual(["move.example"]);
  });

  it("findPending は向きと status を見て pending の行だけ返す", async () => {
    const store = create();
    await store.create(pendingInbound());

    expect(await store.findPending("move.example", "in")).not.toBeNull();
    expect(await store.findPending("move.example", "out")).toBeNull();
    expect(await store.findPending("nope.example", "in")).toBeNull();
  });

  it("確定した行は findPending に出なくなる", async () => {
    const store = create();
    const created = await store.create(pendingInbound());
    await store.update(created.id, {
      status: "approved",
      completedAt: new Date("2026-08-26T00:05:00.000Z"),
    });

    expect(await store.findPending("move.example", "in")).toBeNull();
    const settled = await store.findById(created.id);
    expect(settled?.status).toBe("approved");
    expect(settled?.completedAt?.toISOString()).toBe(
      "2026-08-26T00:05:00.000Z",
    );
    // 差分に含めなかった列は変わらない
    expect(settled?.counterpartRegistrarId).toBe("REG-OTHER");
  });

  it("findByMessageId は registry ごとに引き分ける（二重処理防止の冪等キー）", async () => {
    const store = create();
    await store.create(
      pendingInbound({ registry: "kitaqsign", registryMessageId: "42" }),
    );

    expect(await store.findByMessageId("kitaqsign", "42")).not.toBeNull();
    expect(await store.findByMessageId("kitaqnic", "42")).toBeNull();
  });

  it("list はユーザーの全行を返す（並びは created_at 降順。同着は id 昇順の無意味なタイブレーク）", async () => {
    const store = create();
    const created = [
      await store.create(pendingInbound({ domainName: "a.example" })),
      await store.create(pendingInbound({ domainName: "b.example" })),
      await store.create(pendingInbound({ domainName: "c.example" })),
    ];

    const listed = await store.list(userId);
    expect(listed).toHaveLength(3);
    // 同一ミリ秒に作られると created_at が同着になるため、順序ではなく
    // 「降順が崩れていないこと」と「全件が揃うこと」を見る
    expect(new Set(listed.map((r) => r.id))).toEqual(
      new Set(created.map((r) => r.id)),
    );
    for (let i = 1; i < listed.length; i += 1) {
      const previous = listed[i - 1];
      const current = listed[i];
      if (previous === undefined || current === undefined) {
        throw new Error("list の要素が欠けている");
      }
      expect(previous.createdAt.getTime()).toBeGreaterThanOrEqual(
        current.createdAt.getTime(),
      );
    }
  });

  it("findPending は同じドメイン・向きの pending 行を返す", async () => {
    const store = create();
    await store.create(pendingInbound({ domainName: "a.example" }));

    const found = await store.findPending("a.example", "in");
    expect(found).toMatchObject({
      domainName: "a.example",
      direction: "in",
      status: "pending",
    });
  });

  it("存在しない ID の update は null", async () => {
    const store = create();
    expect(
      await store.update("00000000-0000-4000-8000-0000000000aa", {
        status: "rejected",
      }),
    ).toBeNull();
  });
});
