import { describe, expect, it } from "vitest";
import {
  CONSUMPTION_TAX_RATE,
  DUMMY_TLD_UNIT_PRICES,
  formatJpy,
  quoteOrder,
  RESTORE_FEE,
  tldUnitPrice,
} from "./pricing";
import { SUPPORTED_TLDS } from "./tlds";

describe("固定ダミー価格表（docs/requirements.md FR-19）", () => {
  it("対応 TLD 22 種すべてに単価がある", () => {
    for (const tld of SUPPORTED_TLDS) {
      expect(DUMMY_TLD_UNIT_PRICES[tld], tld).toBeGreaterThan(0);
    }
  });

  it("tldUnitPrice はドット付き・大文字も受け付ける", () => {
    expect(tldUnitPrice("com")).toBe(1_480);
    expect(tldUnitPrice(".COM")).toBe(1_480);
  });

  it("未対応 TLD は null", () => {
    expect(tldUnitPrice("example")).toBeNull();
  });

  it("復旧費用は既存のダミー表示（¥3,300）と一致する", () => {
    expect(RESTORE_FEE).toBe(3_300);
  });
});

describe("quoteOrder", () => {
  it("登録: 単価 × 年数 + 消費税 10%（端数切り捨て）", () => {
    const quote = quoteOrder({
      kind: "register",
      domain: "takutaku.com",
      years: 2,
    });
    const unit = tldUnitPrice("com") ?? 0;
    expect(quote).toEqual({
      kind: "register",
      domain: "takutaku.com",
      tld: "com",
      years: 2,
      unitPrice: unit,
      subtotal: unit * 2,
      tax: Math.floor(unit * 2 * CONSUMPTION_TAX_RATE),
      total: unit * 2 + Math.floor(unit * 2 * CONSUMPTION_TAX_RATE),
      currency: "JPY",
    });
  });

  it("更新も同じ単価表を使う", () => {
    const register = quoteOrder({
      kind: "register",
      domain: "a.xyz",
      years: 1,
    });
    const renew = quoteOrder({ kind: "renew", domain: "a.xyz", years: 1 });
    expect(renew?.total).toBe(register?.total);
    expect(renew?.kind).toBe("renew");
  });

  it("未対応 TLD は null", () => {
    expect(
      quoteOrder({ kind: "register", domain: "a.example", years: 1 }),
    ).toBeNull();
  });

  it("年数が 1〜10 の整数でなければ null", () => {
    expect(quoteOrder({ kind: "renew", domain: "a.com", years: 0 })).toBeNull();
    expect(
      quoteOrder({ kind: "renew", domain: "a.com", years: 11 }),
    ).toBeNull();
    expect(
      quoteOrder({ kind: "renew", domain: "a.com", years: 1.5 }),
    ).toBeNull();
  });
});

describe("formatJpy", () => {
  it("¥ + 3 桁区切り", () => {
    expect(formatJpy(0)).toBe("¥0");
    expect(formatJpy(1_480)).toBe("¥1,480");
    expect(formatJpy(1_234_567)).toBe("¥1,234,567");
  });
});
