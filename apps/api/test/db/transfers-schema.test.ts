import { type Db, schema } from "@dopamin/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, resetTestDb } from "../helpers/db";

/**
 * transfers（docs/requirements.md §9.1 / FR-12）のスキーマ制約を pglite で検証する。
 * domain_id の ON DELETE SET NULL と UNIQUE(registry, registry_message_id) は
 * マイグレーション（packages/db/drizzle）でしか表現されないので、DDL を実際に当てて確かめる。
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
});

/** drizzle は DB エラーを包んで投げるので cause を辿って全文を集める */
function errorText(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join(" / ");
}

async function insertUser(): Promise<string> {
  const rows = await db
    .insert(schema.users)
    .values({ displayName: "移管テスト" })
    .returning({ id: schema.users.id });
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("users の INSERT に失敗した");
  return id;
}

async function insertDomain(userId: string, name: string): Promise<string> {
  const rows = await db
    .insert(schema.domains)
    .values({
      userId,
      name,
      sld: name.split(".")[0] ?? name,
      tld: name.split(".").slice(1).join("."),
      registry: "mock",
      statuses: ["ok"],
    })
    .returning({ id: schema.domains.id });
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("domains の INSERT に失敗した");
  return id;
}

describe("transfers スキーマ（§9.1）", () => {
  it("§9.1 の列をすべて往復できる", async () => {
    const userId = await insertUser();
    const domainId = await insertDomain(userId, "tkt-lab.net");
    const requestedAt = new Date("2026-08-26T00:00:00.000Z");
    const actByAt = new Date("2026-08-26T00:20:00.000Z");

    await db.insert(schema.transfers).values({
      userId,
      domainId,
      domainName: "tkt-lab.net",
      registry: "mock",
      direction: "in",
      status: "pending",
      registryStatus: "pending",
      counterpartRegistrarId: "REG-OTHER",
      registryMessageId: "9007199254740993",
      requestedAt,
      actByAt,
      raw: { msgType: "transfer_request" },
    });

    const rows = await db
      .select()
      .from(schema.transfers)
      .where(eq(schema.transfers.domainName, "tkt-lab.net"));
    const row = rows[0];
    expect(row?.domainId).toBe(domainId);
    expect(row?.registryStatus).toBe("pending");
    expect(row?.counterpartRegistrarId).toBe("REG-OTHER");
    // int64 の桁を落とさないよう text で持つ（PollMessage.id）
    expect(row?.registryMessageId).toBe("9007199254740993");
    expect(row?.requestedAt?.toISOString()).toBe(requestedAt.toISOString());
    expect(row?.actByAt?.toISOString()).toBe(actByAt.toISOString());
    expect(row?.completedAt).toBeNull();
  });

  it("domains を削除しても transfers 行は残り domain_id だけ NULL になる（ON DELETE SET NULL）", async () => {
    const userId = await insertUser();
    const domainId = await insertDomain(userId, "dopamin.example");
    await db.insert(schema.transfers).values({
      userId,
      domainId,
      domainName: "dopamin.example",
      registry: "mock",
      direction: "out",
      status: "approved",
    });

    await db.delete(schema.domains).where(eq(schema.domains.id, domainId));

    const rows = await db.select().from(schema.transfers);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.domainId).toBeNull();
    // ドメインの識別は domain_name が正なので履歴は読める
    expect(rows[0]?.domainName).toBe("dopamin.example");
  });

  it("同じ registry の同じ Poll メッセージ ID は 2 件目が弾かれる（二重処理防止）", async () => {
    const userId = await insertUser();
    const base = {
      userId,
      domainName: "poll-dup.example",
      registry: "kitaqnic",
      direction: "in" as const,
      status: "pending",
      registryMessageId: "12345",
    };
    await db.insert(schema.transfers).values(base);

    const error = await db
      .insert(schema.transfers)
      .values(base)
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect(errorText(error)).toContain("transfers_registry_message_id_uniq");
    expect(await db.$count(schema.transfers)).toBe(1);
  });

  it("レジストリが違えば同じメッセージ ID を持てる（ID はレジストリごとの採番）", async () => {
    const userId = await insertUser();
    await db.insert(schema.transfers).values([
      {
        userId,
        domainName: "a.example",
        registry: "kitaqnic",
        direction: "in",
        status: "pending",
        registryMessageId: "1",
      },
      {
        userId,
        domainName: "b.example",
        registry: "kitaqsign",
        direction: "in",
        status: "pending",
        registryMessageId: "1",
      },
    ]);

    expect(await db.$count(schema.transfers)).toBe(2);
  });

  it("Poll 由来でない行（registry_message_id が NULL）は同じ registry で何件でも入る", async () => {
    const userId = await insertUser();
    await db.insert(schema.transfers).values([
      {
        userId,
        domainName: "c.example",
        registry: "kitaqnic",
        direction: "in",
        status: "pending",
      },
      {
        userId,
        domainName: "d.example",
        registry: "kitaqnic",
        direction: "in",
        status: "pending",
      },
    ]);

    expect(await db.$count(schema.transfers)).toBe(2);
  });
});
