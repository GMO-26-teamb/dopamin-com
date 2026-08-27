import { describe, expect, it } from "vitest";
import { toDomainSummary } from "../../src/services/domain.service";
import type { DomainRecord } from "../../src/services/domain-store";

/** FR-02 の一覧要約への写像（純粋関数）。 */

function record(overrides: Partial<DomainRecord> = {}): DomainRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
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
    rgpUntil: null,
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

  it("猶予期限が行に入っていれば rgpUntil に出す（#211）", () => {
    const base = record();
    const summary = toDomainSummary(
      {
        ...base,
        info: { ...base.info, rgpStatuses: ["redemptionPeriod"] },
        rgpUntil: new Date("2026-09-25T00:00:00.000Z"),
      },
      false,
    );
    expect(summary.rgpStatuses).toEqual(["redemptionPeriod"]);
    expect(summary.rgpUntil).toBe("2026-09-25T00:00:00.000Z");
  });

  it("猶予期限が分からない行は rgpUntil を null にする（0 日と偽らない・#211）", () => {
    const base = record();
    const summary = toDomainSummary(
      { ...base, info: { ...base.info, rgpStatuses: ["redemptionPeriod"] } },
      false,
    );
    expect(summary.rgpUntil).toBeNull();
  });

  it("移管一覧（FR-12）が入るまで transfer は null", () => {
    expect(toDomainSummary(record(), false).transfer).toBeNull();
  });
});
