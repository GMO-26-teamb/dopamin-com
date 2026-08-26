import { afterEach, describe, expect, it } from "vitest";
import {
  requireNotOwnedByOtherUser,
  requireOwnedDomain,
  toDomainSummary,
} from "../../src/services/domain.service";
import {
  createInMemoryDomainStore,
  type DomainRecord,
  setDomainStoreForTesting,
} from "../../src/services/domain-store";

/** FR-02 の一覧要約への写像（純粋関数）と、所有権チェック（NFR-04 / AC-12-5）。 */

function record(overrides: Partial<DomainRecord> = {}): DomainRecord {
  return {
    userId: "user-1",
    name: "example.com",
    registry: "kitaqsign",
    ownership: "owned",
    info: {
      name: "example.com",
      registry: "kitaqsign",
      statuses: ["ok"],
      registrant: "C-1",
      contacts: {},
      nameservers: ["ns1.example.com"],
      registeredAt: "2026-08-01T00:00:00.000Z",
      updatedAt: null,
      expiresAt: "2027-08-01T00:00:00.000Z",
      lastTransferAt: null,
      sponsoringRegistrarId: null,
      rgpStatuses: [],
    },
    syncedAt: new Date("2026-08-26T01:02:03.000Z"),
    ...overrides,
  };
}

describe("toDomainSummary", () => {
  it("FQDN を sld / tld に分割し、同期時刻を ISO 8601 で返す", () => {
    const summary = toDomainSummary(record(), false);
    expect(summary).toMatchObject({
      name: "example.com",
      sld: "example",
      tld: "com",
      registry: "kitaqsign",
      ownership: "owned",
      statuses: ["ok"],
      rgpStatuses: [],
      expiresAt: "2027-08-01T00:00:00.000Z",
      syncedAt: "2026-08-26T01:02:03.000Z",
      stale: false,
    });
  });

  it("stale は呼び出し側の判断をそのまま載せる（AC-07-2）", () => {
    expect(toDomainSummary(record(), true).stale).toBe(true);
  });

  it("多段ラベルでも SLD が欠けない", () => {
    const summary = toDomainSummary(record({ name: "api.example.com" }), false);
    expect(summary.sld).toBe("api.example");
    expect(summary.tld).toBe("com");
  });

  it("rgpUntil は常に null（両レジストリの info が猶予期限を返さないため）", () => {
    const base = record();
    const summary = toDomainSummary(
      { ...base, info: { ...base.info, rgpStatuses: ["redemptionPeriod"] } },
      false,
    );
    expect(summary.rgpStatuses).toEqual(["redemptionPeriod"]);
    expect(summary.rgpUntil).toBeNull();
  });

  it("移管一覧（FR-12）が入るまで transfer は null", () => {
    expect(toDomainSummary(record(), false).transfer).toBeNull();
  });
});

describe("requireOwnedDomain（NFR-04 / AC-02-1 / AC-12-5）", () => {
  const OWNER = "user-1";
  const OTHER = "user-2";

  /** 与えた行だけを持つストアに差し替える。 */
  function installStore(records: DomainRecord[]): void {
    setDomainStoreForTesting(createInMemoryDomainStore(records));
  }

  afterEach(() => {
    setDomainStoreForTesting(null);
  });

  it("保有していないドメインは NOT_FOUND", async () => {
    installStore([]);
    await expect(
      requireOwnedDomain(OWNER, "example.com"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("他ユーザーの行は FORBIDDEN", async () => {
    installStore([record({ userId: OTHER })]);
    await expect(
      requireOwnedDomain(OWNER, "example.com"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("自分の保有行はそのまま返す（forWrite の有無に関わらず）", async () => {
    installStore([record()]);
    await expect(
      requireOwnedDomain(OWNER, "example.com"),
    ).resolves.toMatchObject({ name: "example.com", ownership: "owned" });
    await expect(
      requireOwnedDomain(OWNER, "example.com", { forWrite: true }),
    ).resolves.toMatchObject({ ownership: "owned" });
  });

  it("AC-12-5: 移管 OUT 済みの行への書き込みは OPERATION_NOT_ALLOWED", async () => {
    installStore([record({ ownership: "transferred_out" })]);
    await expect(
      requireOwnedDomain(OWNER, "example.com", { forWrite: true }),
    ).rejects.toMatchObject({
      code: "OPERATION_NOT_ALLOWED",
      // §10.3 共通の statuses に加えて、EPP ステータス以外の理由を reason で区別する
      details: { reason: "transferred_out", statuses: ["transferred_out"] },
    });
  });

  it("移管 OUT 済みでも参照（forWrite なし）は通す（S-34 の表示のみ）", async () => {
    installStore([record({ ownership: "transferred_out" })]);
    await expect(
      requireOwnedDomain(OWNER, "example.com"),
    ).resolves.toMatchObject({ ownership: "transferred_out" });
  });

  it("所有権より先に存在を見る（他ユーザーの行が無ければ NOT_FOUND）", async () => {
    installStore([record({ userId: OTHER, name: "other.com" })]);
    await expect(
      requireOwnedDomain(OWNER, "example.com", { forWrite: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("requireNotOwnedByOtherUser（FR-12 移管系の所有権チェック）", () => {
  const OWNER = "user-1";
  const OTHER = "user-2";

  afterEach(() => {
    setDomainStoreForTesting(null);
  });

  it("行が無ければ null を返して通す（移管 IN は domains 行を持たない）", async () => {
    setDomainStoreForTesting(createInMemoryDomainStore([]));
    await expect(
      requireNotOwnedByOtherUser(OWNER, "example.com"),
    ).resolves.toBeNull();
  });

  it("自分の保有行は通す", async () => {
    setDomainStoreForTesting(createInMemoryDomainStore([record()]));
    await expect(
      requireNotOwnedByOtherUser(OWNER, "example.com"),
    ).resolves.toMatchObject({ userId: OWNER });
  });

  it("他ユーザーが保有中の行は FORBIDDEN", async () => {
    setDomainStoreForTesting(
      createInMemoryDomainStore([record({ userId: OTHER })]),
    );
    await expect(
      requireNotOwnedByOtherUser(OWNER, "example.com"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("他ユーザーの移管 OUT 済みの行は妨げにしない（出戻りの移管 IN を許す）", async () => {
    setDomainStoreForTesting(
      createInMemoryDomainStore([
        record({ userId: OTHER, ownership: "transferred_out" }),
      ]),
    );
    await expect(
      requireNotOwnedByOtherUser(OWNER, "example.com"),
    ).resolves.toMatchObject({ ownership: "transferred_out" });
  });
});
