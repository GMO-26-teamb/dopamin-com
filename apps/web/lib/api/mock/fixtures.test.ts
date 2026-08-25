import { describe, expect, it } from "vitest";
import { at, days, MOCK_NOW, minutes } from "./fixtures";

describe("MOCK_NOW", () => {
  it("テスト環境では固定値（相対表示が実行時刻に左右されない）", () => {
    expect(process.env.NODE_ENV).toBe("test");
    expect(MOCK_NOW.toISOString()).toBe("2026-08-26T01:00:00.000Z");
  });

  it("at() は基準時刻からの相対時刻を返す", () => {
    expect(at(0)).toBe(MOCK_NOW.toISOString());
    expect(at(days(23))).toBe(
      new Date(MOCK_NOW.getTime() + 23 * 24 * 60 * 60_000).toISOString(),
    );
    expect(at(-minutes(3))).toBe(
      new Date(MOCK_NOW.getTime() - 3 * 60_000).toISOString(),
    );
  });
});
