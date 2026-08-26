import { type Db, schema } from "@dopamin/db";
import type { DomainInfo } from "@dopamin/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DomainRecord } from "../../src/services/domain-row";
import {
  createDbDomainStore,
  type DomainStore,
} from "../../src/services/domain-store";
import { createTestDb, resetTestDb } from "../helpers/db";

/**
 * `createDbDomainStore` の実 SQL 経路を pglite（packages/db/drizzle を全適用）で検証する。
 *
 * `domain-row.test.ts` は行 ↔ レコードの純粋写像しか見ないため、本 PR の中核である
 * 「`domains_name_unique` を落として部分一意インデックス `domains_name_owned_uniq` に置き換え、
 * `ON CONFLICT` を同じ述語で絞る」という **DB の意味論** は、ここでしか守れない
 * （ルートテストは `createInMemoryDomainStore` で実 SQL を迂回する）。
 */

let db: Db;
let closeDb: () => Promise<void>;
let store: DomainStore;
let user1: string;
let user2: string;

const INFO: DomainInfo = {
  name: "example.com",
  registry: "kitaqsign",
  statuses: ["ok"],
  registrant: "C-1",
  contacts: { TECH: "C-2" },
  nameservers: ["ns1.example.com"],
  registeredAt: "2026-08-01T00:00:00.000Z",
  updatedAt: null,
  expiresAt: "2027-08-01T00:00:00.000Z",
  lastTransferAt: null,
  sponsoringRegistrarId: null,
  rgpStatuses: [],
};

function record(
  userId: string,
  name = "example.com",
  overrides: Partial<DomainInfo> = {},
): DomainRecord {
  return {
    userId,
    name,
    registry: "kitaqsign",
    ownership: "owned",
    info: { ...INFO, name, ...overrides },
    syncedAt: new Date("2026-08-26T00:00:00.000Z"),
  };
}

/**
 * 保有中の行だけを移管 OUT 済みにする（#57 / #58 が入るまではテストから直接 UPDATE で作る）。
 * 既存の履歴行の transferred_out_at を上書きしないよう ownership でも絞る。
 */
async function markTransferredOut(name: string, at: Date): Promise<void> {
  await db
    .update(schema.domains)
    .set({ ownership: "transferred_out", transferredOutAt: at })
    .where(
      and(eq(schema.domains.name, name), eq(schema.domains.ownership, "owned")),
    );
}

function rowsOf(name: string) {
  return db.select().from(schema.domains).where(eq(schema.domains.name, name));
}

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
  store = createDbDomainStore(db);
}, 30_000);

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await resetTestDb(db);
  const [u1, u2] = await db
    .insert(schema.users)
    .values([{ displayName: "u1" }, { displayName: "u2" }])
    .returning();
  if (!u1 || !u2) throw new Error("テスト用ユーザーの作成に失敗した");
  user1 = u1.id;
  user2 = u2.id;
});

describe("upsert", () => {
  it("同名の保有中の行は 2 行にならず上書きされる（部分一意インデックスが効いている）", async () => {
    await store.upsert(record(user1));
    await store.upsert(
      record(user1, "example.com", { statuses: ["clientHold"] }),
    );

    const rows = await rowsOf("example.com");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.statuses).toEqual(["clientHold"]);
  });

  it("保有中の同名行は最新の所有者で上書きする（移管 IN / 廃止後の再取得）", async () => {
    await store.upsert(record(user1));
    await store.upsert(record(user2));

    const rows = await rowsOf("example.com");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(user2);
  });

  /**
   * AC-12-5。`targetWhere` が無いと ON CONFLICT が部分一意インデックスに一致せず
   * `there is no unique or exclusion constraint matching the ON CONFLICT specification`
   * で落ちる。この 1 件がその回帰を止める。
   */
  it("AC-12-5: transferred_out の履歴行を残したまま同名を owned で再取得できる", async () => {
    await store.upsert(record(user1));
    await markTransferredOut(
      "example.com",
      new Date("2026-08-10T00:00:00.000Z"),
    );

    await store.upsert(record(user2));

    const rows = await rowsOf("example.com");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.ownership).sort()).toEqual([
      "owned",
      "transferred_out",
    ]);
  });

  it("履歴行が複数あっても同名を owned で再取得できる", async () => {
    await store.upsert(record(user1));
    await markTransferredOut(
      "example.com",
      new Date("2026-06-01T00:00:00.000Z"),
    );
    await store.upsert(record(user1));
    await markTransferredOut(
      "example.com",
      new Date("2026-07-01T00:00:00.000Z"),
    );

    await store.upsert(record(user2));

    const rows = await rowsOf("example.com");
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.ownership === "owned")).toHaveLength(1);
  });

  it("繰り返し呼んでも落ちない（prepared statement が generic plan に切り替わっても述語を畳める）", async () => {
    for (let i = 0; i < 8; i++) {
      await store.upsert(
        record(user1, "example.com", { statuses: [`ok-${i}`] }),
      );
    }
    const rows = await rowsOf("example.com");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.statuses).toEqual(["ok-7"]);
  });

  it("ownership が owned でないレコードは履歴行を重複させずに落とす", async () => {
    const transferredOut: DomainRecord = {
      ...record(user1),
      ownership: "transferred_out",
    };
    await expect(store.upsert(transferredOut)).rejects.toThrow(
      /ownership=owned/,
    );
    expect(await rowsOf("example.com")).toHaveLength(0);
  });
});

describe("find", () => {
  it("保有中の行を優先して返す", async () => {
    await store.upsert(record(user1));
    await markTransferredOut(
      "example.com",
      new Date("2026-08-10T00:00:00.000Z"),
    );
    await store.upsert(record(user2));

    const found = await store.find("example.com");
    expect(found?.ownership).toBe("owned");
    expect(found?.userId).toBe(user2);
  });

  it("保有中の行が無ければ最後に移管 OUT した行を返す", async () => {
    // 先に作られた行を「後で」移管 OUT する。created_at 順では逆になる並び
    await store.upsert(record(user1));
    await db
      .update(schema.domains)
      .set({ createdAt: new Date("2026-01-01T00:00:00.000Z") })
      .where(eq(schema.domains.name, "example.com"));
    await markTransferredOut(
      "example.com",
      new Date("2026-08-01T00:00:00.000Z"),
    );

    await store.upsert(record(user2));
    await db
      .update(schema.domains)
      .set({ createdAt: new Date("2026-02-01T00:00:00.000Z") })
      .where(eq(schema.domains.ownership, "owned"));
    await markTransferredOut(
      "example.com",
      new Date("2026-03-01T00:00:00.000Z"),
    );
    // ここで 2 行とも transferred_out。最後に OUT したのは user2 の行ではなく user1 の行

    const found = await store.find("example.com");
    expect(found?.ownership).toBe("transferred_out");
    expect(found?.userId).toBe(user1);
  });

  it("行が無ければ null", async () => {
    expect(await store.find("nope.com")).toBeNull();
  });
});

describe("remove", () => {
  it("保有中の行だけを消し、移管 OUT 済みの履歴行は残す", async () => {
    await store.upsert(record(user1));
    await markTransferredOut(
      "example.com",
      new Date("2026-08-10T00:00:00.000Z"),
    );
    await store.upsert(record(user2));

    await store.remove("example.com");

    const rows = await rowsOf("example.com");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ownership).toBe("transferred_out");
  });
});

describe("list", () => {
  it("そのユーザーの行だけを名前順で返す", async () => {
    await store.upsert(record(user1, "b.com"));
    await store.upsert(record(user1, "a.com"));
    await store.upsert(record(user2, "c.com"));

    const list = await store.list(user1);
    expect(list.map((r) => r.name)).toEqual(["a.com", "b.com"]);
  });
});
