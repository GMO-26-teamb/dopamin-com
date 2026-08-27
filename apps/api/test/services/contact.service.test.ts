import { type Db, schema } from "@dopamin/db";
import { MockRegistryAdapter } from "@dopamin/registry";
import type { RegistrantProfile } from "@dopamin/shared";
import { DEFAULT_REGISTRANT_PROFILE } from "@dopamin/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type ContactStore,
  createDbContactStore,
  createInMemoryContactStore,
  ensureRegistryContact,
  setContactStoreForTesting,
} from "../../src/services/contact.service";
import { createTestDb, resetTestDb } from "../helpers/db";

/**
 * コンタクトの再利用（FR-06 / FR-09 / §9.1 `contacts`。#72）。
 *
 * ユーザー × レジストリ × ロールで 1 件を使い回し、内容が変わったときだけ
 * `contact:update` で差し替える、という不変条件を両ストア実装で確かめる。
 */

let db: Db;
let closeDb: () => Promise<void>;
let userId: string;
let adapter: MockRegistryAdapter;

const OTHER_PROFILE: RegistrantProfile = {
  name: "Hanako Test",
  email: "hanako.test@example.net",
  street: "Redacted for Privacy",
  city: "Redacted for Privacy",
  countryCode: "US",
};

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
}, 30_000);

afterAll(async () => {
  setContactStoreForTesting(null);
  await closeDb();
});

beforeEach(async () => {
  await resetTestDb(db);
  const rows = await db
    .insert(schema.users)
    .values({ displayName: "コンタクトテスト" })
    .returning({ id: schema.users.id });
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error("users の INSERT に失敗した");
  }
  userId = id;
  adapter = new MockRegistryAdapter({ id: "kitaqsign" });
});

const implementations: [string, () => ContactStore][] = [
  ["Drizzle（pglite）", () => createDbContactStore(db)],
  ["インメモリ", () => createInMemoryContactStore()],
];

describe.each(implementations)("ensureRegistryContact（%s）", (_l, create) => {
  beforeEach(() => {
    setContactStoreForTesting(create());
  });

  it("未作成ならレジストリにコンタクトを作って ID を返す", async () => {
    const id = await ensureRegistryContact(userId, adapter, "registrant");
    expect(id).toBeTruthy();
    expect(adapter.peekContact(id)).toEqual(DEFAULT_REGISTRANT_PROFILE);
  });

  it("同じ内容なら 2 回目はレジストリを呼ばず同じ ID を返す（使い捨てを作らない）", async () => {
    const first = await ensureRegistryContact(userId, adapter, "registrant");
    const second = await ensureRegistryContact(userId, adapter, "registrant");
    expect(second).toBe(first);
  });

  it("内容が変わったら ID は据え置きで contact:update する", async () => {
    const first = await ensureRegistryContact(userId, adapter, "registrant");
    const second = await ensureRegistryContact(
      userId,
      adapter,
      "registrant",
      OTHER_PROFILE,
    );

    // 同じ ID を参照している全ドメインに反映される（ID を増やさない）
    expect(second).toBe(first);
    expect(adapter.peekContact(first)).toEqual(OTHER_PROFILE);
  });

  it("プロファイルを省略したら既存の中身を変えない（登録のたびに既定へ戻さない）", async () => {
    // 情報修正（FR-09）で登録者を変えたあと、登録（FR-06）を既定のまま通す流れ。
    // コンタクトはユーザー × レジストリで 1 件を共有するので、ここで既定に
    // 戻すと同じ ID を参照している既存ドメインの登録者まで巻き添えで戻る
    const first = await ensureRegistryContact(
      userId,
      adapter,
      "registrant",
      OTHER_PROFILE,
    );
    const second = await ensureRegistryContact(userId, adapter, "registrant");

    expect(second).toBe(first);
    expect(adapter.peekContact(first)).toEqual(OTHER_PROFILE);
  });

  it("ロールが違えば別のコンタクトになる", async () => {
    const registrant = await ensureRegistryContact(
      userId,
      adapter,
      "registrant",
    );
    const tech = await ensureRegistryContact(userId, adapter, "tech");
    expect(tech).not.toBe(registrant);
  });

  it("レジストリが違えば別のコンタクトになる（ID はレジストラ内で一意）", async () => {
    const kitaqnic = new MockRegistryAdapter({ id: "kitaqnic" });
    const a = await ensureRegistryContact(userId, adapter, "registrant");
    const b = await ensureRegistryContact(userId, kitaqnic, "registrant");
    expect(b).not.toBe(a);
  });
});

describe("ensureRegistryContact（Drizzle 固有）", () => {
  beforeEach(() => {
    setContactStoreForTesting(createDbContactStore(db));
  });

  it("contacts 行は 1 ユーザー × レジストリ × ロールにつき 1 行だけ", async () => {
    await ensureRegistryContact(userId, adapter, "registrant");
    await ensureRegistryContact(userId, adapter, "registrant", OTHER_PROFILE);

    const rows = await db.select().from(schema.contacts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId,
      registry: "kitaqsign",
      role: "registrant",
      name: OTHER_PROFILE.name,
      email: OTHER_PROFILE.email,
    });
    // payload には送ったプロファイルをそのまま残す（ダミー値のみ）
    expect(rows[0]?.payload).toEqual(OTHER_PROFILE);
  });

  it("ユーザーを消すとコンタクトも消える（ON DELETE CASCADE）", async () => {
    await ensureRegistryContact(userId, adapter, "registrant");
    await resetTestDb(db);
    expect(await db.select().from(schema.contacts)).toEqual([]);
  });
});
