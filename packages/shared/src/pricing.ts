import { splitDomainName } from "./domain-name";

/**
 * 固定ダミー価格（docs/requirements.md FR-19 / §2.2）。
 *
 * 実価格・実決済は非スコープ。決済画面（モック）で「単価 × 年数 + 消費税」を
 * 見せるためだけの値で、レジストリの料金とは無関係。単価は TLD ごとに固定し、
 * 登録・更新で同じ表を使う。復旧費用は FR-11 のダミー表示（¥3,300）に合わせる。
 */

export const PRICE_CURRENCY = "JPY" as const;

/** 消費税率（10%）。端数は切り捨て。 */
export const CONSUMPTION_TAX_RATE = 0.1;

/** TLD 別の年額（税抜、JPY）。対応 TLD（`tlds.ts`）を網羅する。 */
export const DUMMY_TLD_UNIT_PRICES: Readonly<Record<string, number>> = {
  // kitaqsign
  com: 1_480,
  net: 1_680,
  org: 1_780,
  info: 1_980,
  // kitaqnic
  xyz: 980,
  online: 1_280,
  site: 1_280,
  tech: 2_480,
  space: 1_180,
  store: 2_980,
  website: 1_480,
  press: 3_480,
  host: 4_980,
  fun: 1_280,
  icu: 780,
  cyou: 680,
  sbs: 680,
  bond: 1_480,
  cfd: 1_480,
  art: 1_980,
  build: 3_980,
  ceo: 5_980,
};

/** 復旧（RGP）費用（税抜、JPY、固定ダミー。FR-11「金額はダミー」）。 */
export const RESTORE_FEE = 3_300;

/** 登録・更新の期間上限（年）。`domainCreateRequestSchema` / AC-08-2 と同じ。 */
const MAX_YEARS = 10;

/** TLD の年額を引く。ドット付き・大文字も受け付ける。未対応 TLD は null。 */
export function tldUnitPrice(tld: string): number | null {
  const normalized = tld.toLowerCase().replace(/^\./, "");
  return DUMMY_TLD_UNIT_PRICES[normalized] ?? null;
}

export type OrderKind = "register" | "renew";

export interface OrderQuoteInput {
  kind: OrderKind;
  /** FQDN（例 `takutaku.com`） */
  domain: string;
  /** 登録 / 延長する年数（1〜10） */
  years: number;
}

export interface OrderQuote {
  kind: OrderKind;
  domain: string;
  tld: string;
  years: number;
  /** 年額（税抜） */
  unitPrice: number;
  /** 単価 × 年数（税抜） */
  subtotal: number;
  /** 消費税（切り捨て） */
  tax: number;
  /** 税込合計 */
  total: number;
  currency: typeof PRICE_CURRENCY;
}

/**
 * 注文の見積もり（単価 × 年数 + 消費税）。
 * 未対応 TLD・範囲外の年数は null（呼び出し側は送信前に弾く）。
 */
export function quoteOrder(input: OrderQuoteInput): OrderQuote | null {
  if (
    !Number.isInteger(input.years) ||
    input.years < 1 ||
    input.years > MAX_YEARS
  ) {
    return null;
  }
  const { tld } = splitDomainName(input.domain);
  const unitPrice = tldUnitPrice(tld);
  if (unitPrice === null) {
    return null;
  }
  const subtotal = unitPrice * input.years;
  const tax = Math.floor(subtotal * CONSUMPTION_TAX_RATE);
  return {
    kind: input.kind,
    domain: input.domain,
    tld,
    years: input.years,
    unitPrice,
    subtotal,
    tax,
    total: subtotal + tax,
    currency: PRICE_CURRENCY,
  };
}

/** JPY の表示（`¥1,480`）。 */
export function formatJpy(amount: number): string {
  return `¥${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
