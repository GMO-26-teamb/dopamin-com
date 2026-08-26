import { describe, expect, it } from "vitest";
import {
  cardBrand,
  cardLast4,
  DECLINED_CARD_NUMBER,
  DEMO_CARD,
  formatCardNumber,
  formatExpiry,
  passesLuhn,
  validateCard,
} from "./card";

const NOW = new Date("2026-08-26T00:00:00+09:00");

describe("formatCardNumber / formatExpiry", () => {
  it("数字以外を落として 4 桁ずつ区切る", () => {
    expect(formatCardNumber("4242-4242 4242abc4242999")).toBe(
      "4242 4242 4242 4242",
    );
    expect(formatCardNumber("42")).toBe("42");
  });

  it("有効期限は MMYY → MM/YY", () => {
    expect(formatExpiry("1")).toBe("1");
    expect(formatExpiry("12")).toBe("12");
    expect(formatExpiry("123")).toBe("12/3");
    expect(formatExpiry("12/34")).toBe("12/34");
    expect(formatExpiry("123456")).toBe("12/34");
  });
});

describe("cardBrand / cardLast4 / passesLuhn", () => {
  it("ブランドを先頭の数字から推定する", () => {
    expect(cardBrand(DEMO_CARD.number)).toBe("Visa");
    expect(cardBrand("5555 5555 5555 4444")).toBe("Mastercard");
    expect(cardBrand("3566 0020 2036 0505")).toBe("JCB");
    expect(cardBrand("3782 822463 10005")).toBe("American Express");
    expect(cardBrand("9999")).toBeNull();
  });

  it("下 4 桁", () => {
    expect(cardLast4(DEMO_CARD.number)).toBe("4242");
  });

  it("デモ用カードも拒否用カードも Luhn を満たす", () => {
    expect(passesLuhn(DEMO_CARD.number)).toBe(true);
    expect(passesLuhn(DECLINED_CARD_NUMBER)).toBe(true);
    expect(passesLuhn("4242 4242 4242 4241")).toBe(false);
    expect(passesLuhn("")).toBe(false);
  });
});

describe("validateCard", () => {
  it("デモ用カードはエラーなし（AC-19-4）", () => {
    expect(validateCard(DEMO_CARD, NOW)).toEqual({});
  });

  it("桁数不足・Luhn 不一致を番号エラーにする", () => {
    expect(validateCard({ ...DEMO_CARD, number: "4242" }, NOW).number).toMatch(
      /14〜16 桁/,
    );
    expect(
      validateCard({ ...DEMO_CARD, number: "4242 4242 4242 4241" }, NOW).number,
    ).toMatch(/正しくありません/);
  });

  it("有効期限は形式・月・過去を弾く", () => {
    expect(validateCard({ ...DEMO_CARD, expiry: "1234" }, NOW).expiry).toMatch(
      /MM\/YY/,
    );
    expect(validateCard({ ...DEMO_CARD, expiry: "13/30" }, NOW).expiry).toMatch(
      /01〜12/,
    );
    expect(validateCard({ ...DEMO_CARD, expiry: "07/26" }, NOW).expiry).toMatch(
      /切れています/,
    );
    // 当月末までは有効
    expect(
      validateCard({ ...DEMO_CARD, expiry: "08/26" }, NOW).expiry,
    ).toBeUndefined();
  });

  it("CVC と名義", () => {
    expect(validateCard({ ...DEMO_CARD, cvc: "12" }, NOW).cvc).toBeDefined();
    expect(validateCard({ ...DEMO_CARD, cvc: "12345" }, NOW).cvc).toBeDefined();
    expect(
      validateCard({ ...DEMO_CARD, holder: "  " }, NOW).holder,
    ).toBeDefined();
  });
});
