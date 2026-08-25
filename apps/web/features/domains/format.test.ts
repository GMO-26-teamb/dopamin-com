import { describe, expect, it } from "vitest";
import {
  daysUntil,
  formatDate,
  formatRelativeTime,
  remainingDays,
  remainingPercent,
} from "./format";

const NOW = new Date("2026-08-26T10:00:00+09:00");
const DAY_MS = 24 * 60 * 60 * 1000;

describe("formatDate", () => {
  it("ローカル日付を YYYY-MM-DD で返す", () => {
    expect(formatDate(NOW.toISOString())).toBe(
      `${NOW.getFullYear()}-${`${NOW.getMonth() + 1}`.padStart(2, "0")}-${`${NOW.getDate()}`.padStart(2, "0")}`,
    );
  });

  it("null と不正な値はプレースホルダ", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("not-a-date")).toBe("—");
  });
});

describe("daysUntil / remainingDays", () => {
  it("暦日で数える（ダッシュボードと詳細で同じ残日数になる）", () => {
    const in23 = new Date(NOW.getTime() + 23 * DAY_MS).toISOString();
    expect(daysUntil(in23, NOW)).toBe(23);
    // 詳細画面は epoch ミリ秒で渡す。結果は Date 渡しと一致すること
    expect(daysUntil(in23, NOW.getTime())).toBe(23);
    expect(remainingDays(in23, NOW)).toBe(23);
  });

  it("過去日は daysUntil が負、remainingDays は 0 で止まる", () => {
    const past = new Date(NOW.getTime() - 3 * DAY_MS).toISOString();
    expect(daysUntil(past, NOW)).toBe(-3);
    expect(remainingDays(past, NOW)).toBe(0);
  });

  it("null と不正な値は daysUntil が null、remainingDays が 0", () => {
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil("not-a-date", NOW)).toBeNull();
    expect(remainingDays(null, NOW)).toBe(0);
  });

  it("同じ暦日なら時刻が違っても 0 日", () => {
    const later = new Date(NOW.getTime() + 3 * 60 * 60 * 1000);
    expect(daysUntil(later.toISOString(), NOW)).toBe(0);
  });
});

describe("formatRelativeTime", () => {
  it("経過時間に応じた日本語を返す", () => {
    const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
    expect(formatRelativeTime(ago(0), NOW)).toBe("たった今");
    expect(formatRelativeTime(ago(3 * 60_000), NOW)).toBe("3分前");
    expect(formatRelativeTime(ago(2 * 60 * 60_000), NOW)).toBe("2時間前");
    expect(formatRelativeTime(ago(5 * DAY_MS), NOW)).toBe("5日前");
    expect(formatRelativeTime(null, NOW)).toBe("—");
  });

  it("epoch ミリ秒でも Date でも同じ結果", () => {
    const iso = new Date(NOW.getTime() - 3 * 60_000).toISOString();
    expect(formatRelativeTime(iso, NOW.getTime())).toBe(
      formatRelativeTime(iso, NOW),
    );
  });
});

describe("remainingPercent", () => {
  it("登録日〜有効期限のうち残っている割合を返す", () => {
    const registeredAt = new Date(NOW.getTime() - 100 * DAY_MS).toISOString();
    const expiresAt = new Date(NOW.getTime() + 300 * DAY_MS).toISOString();
    expect(Math.round(remainingPercent(registeredAt, expiresAt, NOW))).toBe(75);
  });

  it("期限が無い / 逆転しているときは 0", () => {
    const registeredAt = new Date(NOW.getTime() - 100 * DAY_MS).toISOString();
    expect(remainingPercent(registeredAt, null, NOW)).toBe(0);
    expect(
      remainingPercent(
        registeredAt,
        new Date(NOW.getTime() - 200 * DAY_MS).toISOString(),
        NOW,
      ),
    ).toBe(0);
  });
});
