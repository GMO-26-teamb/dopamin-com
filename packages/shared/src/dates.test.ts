import { describe, expect, it } from "vitest";
import {
  daysUntil,
  TRANSFER_AUTO_APPROVE_MS,
  TRANSFER_ELIGIBLE_DAYS,
  transferAutoApproveAt,
  transferEligibleAt,
} from "./dates";

const NOW = new Date(2026, 7, 26, 12, 0, 0);

describe("daysUntil（AC-02-2）", () => {
  it("同じ日なら 0", () => {
    expect(daysUntil(new Date(2026, 7, 26, 0, 0, 0), NOW)).toBe(0);
    expect(daysUntil(new Date(2026, 7, 26, 23, 59, 59), NOW)).toBe(0);
  });

  it("翌日なら 1、前日なら -1", () => {
    expect(daysUntil(new Date(2026, 7, 27, 0, 0, 0), NOW)).toBe(1);
    expect(daysUntil(new Date(2026, 7, 25, 23, 59, 59), NOW)).toBe(-1);
  });

  it("時刻ではなく暦日で数える（NOW より前の時刻でも同じ日なら 0）", () => {
    expect(daysUntil(new Date(2026, 7, 26, 0, 0, 1), NOW)).toBe(0);
  });

  it("30 日警告の境界（ちょうど 30 日 / 31 日）", () => {
    expect(daysUntil(new Date(2026, 8, 25, 12, 0, 0), NOW)).toBe(30);
    expect(daysUntil(new Date(2026, 8, 26, 12, 0, 0), NOW)).toBe(31);
  });

  it("ISO 文字列でも Date でも同じ結果になる", () => {
    const iso = "2026-08-27T00:00:00Z";
    expect(daysUntil(iso, NOW)).toBe(daysUntil(new Date(iso), NOW));
  });

  it("now を省略すると現在時刻が使われる", () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000);
    expect([0, 1]).toContain(daysUntil(soon));
  });
});

describe("transferAutoApproveAt（§9.2 / AC-07-3）", () => {
  it("既定は 20 分（TRANSFER_AUTO_APPROVE_MS）", () => {
    expect(TRANSFER_AUTO_APPROVE_MS).toBe(20 * 60 * 1000);
  });

  it("actByAt が無ければ requestedAt + 20 分", () => {
    const requestedAt = new Date("2026-08-26T12:00:00Z");
    const result = transferAutoApproveAt(requestedAt);
    expect(result.getTime()).toBe(
      requestedAt.getTime() + TRANSFER_AUTO_APPROVE_MS,
    );
  });

  it("actByAt があればそれを優先する（kitaqsign 以外がレジストリ側期限を返す場合）", () => {
    const requestedAt = new Date("2026-08-26T12:00:00Z");
    const actByAt = new Date("2026-08-26T13:30:00Z");
    const result = transferAutoApproveAt(requestedAt, actByAt);
    expect(result.getTime()).toBe(actByAt.getTime());
  });

  it("actByAt が null / undefined ならフォールバックする", () => {
    const requestedAt = "2026-08-26T12:00:00Z";
    expect(transferAutoApproveAt(requestedAt, null).getTime()).toBe(
      transferAutoApproveAt(requestedAt).getTime(),
    );
    expect(transferAutoApproveAt(requestedAt, undefined).getTime()).toBe(
      transferAutoApproveAt(requestedAt).getTime(),
    );
  });

  it("ISO 文字列でも Date でも同じ結果になる", () => {
    const iso = "2026-08-26T12:00:00Z";
    expect(transferAutoApproveAt(iso).getTime()).toBe(
      transferAutoApproveAt(new Date(iso)).getTime(),
    );
  });
});

describe("transferEligibleAt（§9.2、参考表示専用・FR-12 の 60 日ルール非強制）", () => {
  it("60 日定数（TRANSFER_ELIGIBLE_DAYS）", () => {
    expect(TRANSFER_ELIGIBLE_DAYS).toBe(60);
  });

  it("lastTransferAt が無ければ registeredAt + 60 日", () => {
    const registeredAt = new Date("2026-01-01T00:00:00Z");
    const result = transferEligibleAt(registeredAt, null);
    expect(result.getTime()).toBe(
      registeredAt.getTime() + 60 * 24 * 60 * 60 * 1000,
    );
  });

  it("lastTransferAt があり registeredAt より新しければそちらを基準にする", () => {
    const registeredAt = new Date("2026-01-01T00:00:00Z");
    const lastTransferAt = new Date("2026-06-01T00:00:00Z");
    const result = transferEligibleAt(registeredAt, lastTransferAt);
    expect(result.getTime()).toBe(
      lastTransferAt.getTime() + 60 * 24 * 60 * 60 * 1000,
    );
  });

  it("両者の遅い方（max）を基準にする（データ不整合で lastTransferAt が古くても安全）", () => {
    const registeredAt = new Date("2026-06-01T00:00:00Z");
    const lastTransferAt = new Date("2026-01-01T00:00:00Z");
    const result = transferEligibleAt(registeredAt, lastTransferAt);
    expect(result.getTime()).toBe(
      registeredAt.getTime() + 60 * 24 * 60 * 60 * 1000,
    );
  });

  it("ISO 文字列でも Date でも同じ結果になる", () => {
    const registeredAt = "2026-01-01T00:00:00Z";
    const lastTransferAt = "2026-06-01T00:00:00Z";
    expect(transferEligibleAt(registeredAt, lastTransferAt).getTime()).toBe(
      transferEligibleAt(
        new Date(registeredAt),
        new Date(lastTransferAt),
      ).getTime(),
    );
  });
});
