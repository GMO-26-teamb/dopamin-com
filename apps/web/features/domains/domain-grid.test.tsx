import { describe, expect, it } from "vitest";
import type { DomainSummary } from "@/lib/api/types";
import { visibleDomains } from "./domain-grid";

const NOW = new Date("2026-08-26T10:00:00+09:00");

type DomainOverrides = Partial<DomainSummary>;

function makeDomain(overrides: DomainOverrides = {}): DomainSummary {
  return {
    name: "takutaku.com",
    sld: "takutaku",
    tld: "com",
    registry: "kitaqsign",
    statuses: ["ok"],
    rgpStatuses: [],
    ownership: "owned",
    displayStatus: "active",
    registeredAt: new Date(NOW.getTime() - 400 * 86_400_000).toISOString(),
    expiresAt: new Date(NOW.getTime() + 330 * 86_400_000).toISOString(),
    rgpUntil: null,
    syncedAt: NOW.toISOString(),
    stale: false,
    transfer: null,
    ...overrides,
  };
}

describe("visibleDomains", () => {
  it("owned かつ transferred_out でないドメインだけを出す", () => {
    const domain = makeDomain();

    expect(visibleDomains([domain])).toEqual([domain]);
  });

  it("displayStatus が transferred_out のドメインは除外する（AC-02-4）", () => {
    const transferredOut = makeDomain({
      name: "old-blog.xyz",
      displayStatus: "transferred_out",
    });

    expect(visibleDomains([transferredOut])).toEqual([]);
  });

  it("ownership が owned でないドメインは除外する（AC-02-4）", () => {
    const notOwned = makeDomain({
      name: "old-blog.xyz",
      ownership: "transferred_out",
    });

    expect(visibleDomains([notOwned])).toEqual([]);
  });

  it("保有ドメインと移管済みが混在していれば保有分だけ残す", () => {
    const owned = makeDomain({ name: "takutaku.com" });
    const transferredOut = makeDomain({
      name: "old-blog.xyz",
      ownership: "transferred_out",
      displayStatus: "transferred_out",
    });

    expect(visibleDomains([owned, transferredOut])).toEqual([owned]);
  });
});
