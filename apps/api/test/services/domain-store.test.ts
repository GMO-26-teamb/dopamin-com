import { type Db, schema } from "@dopamin/db";
import type { DomainInfo } from "@dopamin/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createDbDomainStore,
  createInMemoryDomainStore,
  type DomainStore,
  type DomainUpsert,
} from "../../src/services/domain-store";
import { createTestDb, resetTestDb } from "../helpers/db";

/**
 * 保有ドメインの永続化のうち、移管（FR-12）が使う経路。
 *
 * `markTransferredOut` は移管 OUT の完了検知（§6.5 / AC-12-5）から呼ばれる。
 * `domains_name_owned_uniq` が部分一意インデックスなので `upsert` では代用できない
 * （`transferred_out` の行は索引に入らず衝突が起きないため、更新ではなく重複行になる）。
 * その前提が本物の DDL で成り立つことをここで確かめる。
 */

let db: Db;
let closeDb: () => Promise<void>;
let userId: string;

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
    .values({ displayName: "移管テスト" })
    .returning({ id: schema.users.id });
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error("users の INSERT に失敗した");
  }
  userId = id;
});

const INFO: DomainInfo = {
  name: "out.example",
  registry: "kitaqsign",
  statuses: ["ok"],
  registrant: "C-1",
  contacts: {},
  nameservers: ["ns1.out.example"],
  registeredAt: "2026-08-01T00:00:00.000Z",
  updatedAt: null,
  expiresAt: "2027-08-01T00:00:00.000Z",
  lastTransferAt: null,
  sponsoringRegistrarId: null,
  rgpStatuses: [],
};

function owned(overrides: Partial<DomainUpsert> = {}): DomainUpsert {
  return {
    userId,
    name: INFO.name,
    registry: "kitaqsign",
    ownership: "owned",
    info: INFO,
    syncedAt: new Date("2026-08-26T00:00:00.000Z"),
    ...overrides,
  };
}

const implementations: [string, () => DomainStore][] = [
  ["Drizzle（pglite）", () => createDbDomainStore(db)],
  ["インメモリ", () => createInMemoryDomainStore()],
];

describe.each(implementations)(
  "DomainStore.markTransferredOut（%s）",
  (_label, create) => {
    const at = new Date("2026-08-26T01:00:00.000Z");

    it("保有中の行を transferred_out に倒し、行は消さない（AC-12-5）", async () => {
      const store = create();
      await store.upsert(owned());

      const moved = await store.markTransferredOut(INFO.name, at);
      expect(moved?.ownership).toBe("transferred_out");

      // 行は履歴として残る（詳細からは読める）
      expect((await store.find(INFO.name))?.ownership).toBe("transferred_out");
    });

    it("保有一覧（FR-02）からは消え、他の保有行は残る", async () => {
      const store = create();
      await store.upsert(owned());
      await store.upsert(owned({ name: "keep.example" }));
      await store.markTransferredOut(INFO.name, at);

      // list は ownership = 'owned' の行だけを返す（§6.5 / AC-12-5）。
      // 「全部消えた」ではなく「移管した行だけ消えた」ことを見る
      expect((await store.list(userId)).map((r) => r.name)).toEqual([
        "keep.example",
      ]);
      // 履歴としては残っているので詳細からは読める
      expect((await store.find(INFO.name))?.ownership).toBe("transferred_out");
    });

    it("保有中の行が無ければ null（二重適用しても壊れない）", async () => {
      const store = create();
      expect(await store.markTransferredOut("missing.example", at)).toBeNull();

      await store.upsert(owned());
      expect(await store.markTransferredOut(INFO.name, at)).not.toBeNull();
      expect(await store.markTransferredOut(INFO.name, at)).toBeNull();
    });
  },
);

describe("DomainStore.markTransferredOut（Drizzle 固有）", () => {
  it("transferred_out_at を記録し、行は増えない", async () => {
    const store = createDbDomainStore(db);
    await store.upsert(owned());
    const at = new Date("2026-08-26T01:00:00.000Z");

    await store.markTransferredOut(INFO.name, at);

    const rows = await db
      .select()
      .from(schema.domains)
      .where(eq(schema.domains.name, INFO.name));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ownership).toBe("transferred_out");
    expect(rows[0]?.transferredOutAt?.toISOString()).toBe(at.toISOString());
  });

  it("移管 OUT 済みの行を残したまま同名を再取得できる（AC-12-5 の出戻り）", async () => {
    const store = createDbDomainStore(db);
    await store.upsert(owned());
    await store.markTransferredOut(INFO.name, new Date());

    // 部分一意インデックスは保有中の行だけが対象なので、新しい保有行を作れる
    const reacquired = await store.upsert(owned());
    expect(reacquired.ownership).toBe("owned");

    const rows = await db
      .select()
      .from(schema.domains)
      .where(eq(schema.domains.name, INFO.name));
    expect(rows).toHaveLength(2);
    // find は保有中の行を優先して返す
    expect((await store.find(INFO.name))?.ownership).toBe("owned");
  });
});
