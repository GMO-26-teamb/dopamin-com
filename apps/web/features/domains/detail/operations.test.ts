import { describe, expect, it } from "vitest";
import type { DomainDetail } from "@/lib/api/types";
import {
  isWithinAddGracePeriod,
  maxRenewPeriod,
  renewedExpiry,
} from "./derive";
import { operationState } from "./operations";

const NOW = Date.parse("2026-08-26T01:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function domain(overrides: Partial<DomainDetail> = {}): DomainDetail {
  return {
    name: "takutaku.com",
    sld: "takutaku",
    tld: "com",
    registry: "kitaqsign",
    statuses: ["ok"],
    rgpStatuses: [],
    ownership: "owned",
    displayStatus: "active",
    registeredAt: new Date(NOW - 400 * DAY).toISOString(),
    expiresAt: new Date(NOW + 330 * DAY).toISOString(),
    rgpUntil: null,
    syncedAt: new Date(NOW - 3 * 60_000).toISOString(),
    stale: false,
    transfer: null,
    nameservers: ["ns1.example.com", "ns2.example.com"],
    registrant: {
      name: "Taro Test",
      email: "taro.test@example.com",
      migrated: true,
    },
    gracePeriods: [],
    transferableFrom: new Date(NOW - 340 * DAY).toISOString(),
    subdomainPlan: null,
    ...overrides,
  };
}

describe("operationState", () => {
  it("Active では 4 操作が可能、復旧だけ不可（RGP ではないため）", () => {
    const target = domain();
    for (const op of ["renew", "update", "delete", "transferOut"] as const) {
      expect(operationState(target, op).allowed).toBe(true);
    }
    expect(operationState(target, "restore")).toEqual({
      allowed: false,
      reason: "RGP ではないため不可",
      blockedBy: [],
    });
  });

  it("Server ステータスは対応する操作だけを止める（AC-07-1）", () => {
    const target = domain({ statuses: ["ok", "serverUpdateProhibited"] });

    const update = operationState(target, "update");
    expect(update.allowed).toBe(false);
    expect(update.reason).toBe("情報修正ロック中");
    expect(update.blockedBy).toEqual(["serverUpdateProhibited"]);
    expect(operationState(target, "renew").allowed).toBe(true);
    expect(operationState(target, "delete").allowed).toBe(true);
  });

  it("pendingTransfer は全操作を止める（S-32）", () => {
    const target = domain({
      statuses: ["ok", "pendingTransfer"],
      displayStatus: "transfer_out_pending",
    });
    for (const op of ["renew", "update", "delete", "transferOut"] as const) {
      const state = operationState(target, op);
      expect(state.allowed).toBe(false);
      expect(state.reason).toBe("移管申請中のため不可");
    }
  });

  it("RGP では復旧のみ可能（S-33）", () => {
    const target = domain({
      displayStatus: "rgp",
      rgpStatuses: ["redemptionPeriod"],
      rgpUntil: new Date(NOW + 18 * DAY).toISOString(),
    });
    expect(operationState(target, "restore").allowed).toBe(true);
  });

  it("pendingDelete では復旧できない（AC-11-2）", () => {
    const target = domain({
      displayStatus: "pending_delete",
      statuses: ["pendingDelete"],
      rgpStatuses: ["pendingDelete"],
    });
    expect(operationState(target, "restore").allowed).toBe(false);
    expect(operationState(target, "delete").reason).toBe(
      "削除処理中のため不可",
    );
  });

  it("キャッシュ表示（S-31）は全操作を止める", () => {
    const target = domain({ stale: true });
    for (const op of [
      "renew",
      "update",
      "delete",
      "transferOut",
      "restore",
    ] as const) {
      expect(operationState(target, op)).toEqual({
        allowed: false,
        reason: "最新化が必要",
        blockedBy: [],
      });
    }
  });

  it("移管済み（S-34）は全操作を止める", () => {
    const target = domain({
      ownership: "transferred_out",
      displayStatus: "transferred_out",
    });
    expect(operationState(target, "renew").reason).toBe("移管済みのため不可");
  });
});

describe("isWithinAddGracePeriod", () => {
  it("Add GP が残っていれば true（D-03 の文言切替）", () => {
    const target = domain({
      registeredAt: new Date(NOW - 2 * DAY).toISOString(),
      gracePeriods: [
        { kind: "add", until: new Date(NOW + 3 * DAY).toISOString() },
      ],
    });
    expect(isWithinAddGracePeriod(target, NOW)).toBe(true);
  });

  it("Add GP が無くても登録から 5 日以内なら true", () => {
    expect(
      isWithinAddGracePeriod(
        domain({ registeredAt: new Date(NOW - 2 * DAY).toISOString() }),
        NOW,
      ),
    ).toBe(true);
  });

  it("登録から 5 日を過ぎたら false", () => {
    expect(isWithinAddGracePeriod(domain(), NOW)).toBe(false);
  });
});

describe("maxRenewPeriod / renewedExpiry", () => {
  it("合計 10 年を超えない範囲だけを選ばせる（AC-08-2）", () => {
    // 残り 1 年弱 → 最大 9 年
    expect(maxRenewPeriod(new Date(NOW + 330 * DAY).toISOString(), NOW)).toBe(
      9,
    );
    // 残り 9 年強 → 最大 0 年（更新できない）
    expect(
      maxRenewPeriod(new Date(NOW + 9.5 * 365 * DAY).toISOString(), NOW),
    ).toBe(0);
    expect(maxRenewPeriod(null, NOW)).toBe(0);
  });

  it("更新後の有効期限を YYYY-MM-DD で返す", () => {
    expect(renewedExpiry("2027-08-25T00:00:00.000Z", 1)).toBe("2028-08-25");
    expect(renewedExpiry("2027-08-25T00:00:00.000Z", 3)).toBe("2030-08-25");
    expect(renewedExpiry(null, 1)).toBe("—");
  });
});
