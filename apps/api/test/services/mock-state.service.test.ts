import { type Db, schema } from "@dopamin/db";
import { MockRegistryAdapter } from "@dopamin/registry";
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
import { createDbMockStateStore } from "../../src/services/mock-state.service";
import { createTestDb, resetTestDb } from "../helpers/db";

/**
 * mock レジストリの状態を DB に逃がすストア（§11.1 / §16.1。#46）。
 * 受け入れ条件は「create → 別リクエストの info が成功する」。
 */

let db: Db;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
}, 30_000);

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await resetTestDb(db);
  await db.delete(schema.mockRegistryState);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function adapter(): MockRegistryAdapter {
  // リクエストごとに新しいインスタンスが立つ状況（Vercel Functions）の再現
  return new MockRegistryAdapter({
    id: "mock",
    store: createDbMockStateStore("mock", () => db),
  });
}

describe("createDbMockStateStore", () => {
  it("受け入れ条件: create したドメインを別インスタンスの info が引ける", async () => {
    await adapter().create({
      name: "demo.com",
      periodYears: 1,
      authInfo: "s3cret",
    });

    const info = await adapter().info("demo.com");
    expect(info.name).toBe("demo.com");

    // 1 レジストリ = 1 行
    const rows = await db.select().from(schema.mockRegistryState);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.registry).toBe("mock");
  });

  it("レジストリごとに状態が分かれる", async () => {
    const kitaqsign = new MockRegistryAdapter({
      id: "kitaqsign",
      store: createDbMockStateStore("kitaqsign", () => db),
    });
    await kitaqsign.create({
      name: "split.com",
      periodYears: 1,
      authInfo: "s3cret",
    });

    // 別レジストリのアダプタからは見えない
    await expect(adapter().info("split.com")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // 書かれているのは kitaqsign の行だけ（参照系は状態を変えないので書き戻さない）
    const rows = await db.select().from(schema.mockRegistryState);
    expect(rows.map((r) => r.registry)).toEqual(["kitaqsign"]);

    // mock 側で作れば行が増え、互いに影響しない
    await adapter().create({
      name: "own.com",
      periodYears: 1,
      authInfo: "s3cret",
    });
    expect(
      (await db.select().from(schema.mockRegistryState))
        .map((r) => r.registry)
        .sort(),
    ).toEqual(["kitaqsign", "mock"]);
    await expect(adapter().info("split.com")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("壊れた JSON が入っていても未保存として扱い、落とさない（NFR-05）", async () => {
    await db
      .insert(schema.mockRegistryState)
      .values({ registry: "mock", snapshot: { bogus: true } });

    const store = createDbMockStateStore("mock", () => db);
    expect(await store.load()).toBeNull();
    // 空の状態から始まるだけで、アダプタは動く
    await expect(
      adapter().create({ name: "ok.com", periodYears: 1, authInfo: "s" }),
    ).resolves.toMatchObject({ name: "ok.com" });
  });

  it("DB が使えなくてもレジストリ操作は落ちない（デモ用途の割り切り）", async () => {
    const broken = () =>
      ({
        select: () => {
          throw new Error("db down");
        },
        insert: () => {
          throw new Error("db down");
        },
      }) as unknown as Db;
    const failing = new MockRegistryAdapter({
      id: "mock",
      store: createDbMockStateStore("mock", broken),
    });

    // プロセス内 Map のまま動き続ける
    await expect(
      failing.create({ name: "resilient.com", periodYears: 1, authInfo: "s" }),
    ).resolves.toMatchObject({ name: "resilient.com" });
    // 失敗は構造化ログに残す（NFR-06）
    expect(console.warn).toHaveBeenCalled();
  });
});
