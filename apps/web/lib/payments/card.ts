import type { PaymentCardInput } from "@/lib/api/types";

/**
 * カード入力の整形・検証（FR-19 決済モック）。
 *
 * 実 PSP（決済代行）には送らない。ここで弾くのは「入力欄として明らかに不正」なものだけで、
 * 成功 / 失敗の判定は `lib/api/payments/mock-gateway.ts`（カード番号で決める）。
 */

/** デモ用のテストカード。決済画面を開いたときの既定値（AC-19-4: 追加入力なしで進める）。 */
export const DEMO_CARD: PaymentCardInput = {
  number: "4242 4242 4242 4242",
  expiry: "12/34",
  cvc: "123",
  holder: "DOPAMIN TARO",
};

/** この番号で支払うとモックが「カード会社に拒否された」を返す（Stripe のテスト番号に倣う）。 */
export const DECLINED_CARD_NUMBER = "4000 0000 0000 0002";

export type CardBrand = "Visa" | "Mastercard" | "JCB" | "American Express";

export interface CardFieldErrors {
  number?: string;
  expiry?: string;
  cvc?: string;
  holder?: string;
}

/** 数字以外を落とす。 */
export function cardDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** 4 桁ごとに空白で区切る（最大 16 桁）。 */
export function formatCardNumber(value: string): string {
  return (
    cardDigits(value)
      .slice(0, 16)
      .match(/.{1,4}/g) ?? []
  ).join(" ");
}

/** `MMYY` → `MM/YY`。 */
export function formatExpiry(value: string): string {
  const digits = cardDigits(value).slice(0, 4);
  return digits.length <= 2
    ? digits
    : `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

/** 先頭の数字からブランドを推定する。不明なら null。 */
export function cardBrand(number: string): CardBrand | null {
  const digits = cardDigits(number);
  if (digits.startsWith("4")) {
    return "Visa";
  }
  if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) {
    return "Mastercard";
  }
  if (/^35/.test(digits)) {
    return "JCB";
  }
  if (/^3[47]/.test(digits)) {
    return "American Express";
  }
  return null;
}

export function cardLast4(number: string): string {
  return cardDigits(number).slice(-4);
}

/** Luhn チェック（桁数の妥当性は別途見る）。 */
export function passesLuhn(number: string): boolean {
  const digits = cardDigits(number);
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    double = !double;
  }
  return digits.length > 0 && sum % 10 === 0;
}

/**
 * 入力欄ごとの検証。エラーが無ければ空オブジェクト。
 * `now` は有効期限の判定基準（テストで固定するため注入可）。
 */
export function validateCard(
  card: PaymentCardInput,
  now: Date = new Date(),
): CardFieldErrors {
  const errors: CardFieldErrors = {};

  const digits = cardDigits(card.number);
  if (digits.length < 14 || digits.length > 16) {
    errors.number = "カード番号は 14〜16 桁で入力してください。";
  } else if (!passesLuhn(digits)) {
    errors.number = "カード番号が正しくありません。";
  }

  const expiry = /^(\d{2})\/(\d{2})$/.exec(card.expiry);
  if (expiry === null) {
    errors.expiry = "有効期限は MM/YY で入力してください。";
  } else {
    const month = Number(expiry[1]);
    const year = 2000 + Number(expiry[2]);
    if (month < 1 || month > 12) {
      errors.expiry = "月は 01〜12 で入力してください。";
    } else {
      // その月の末日まで有効
      const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);
      if (endOfMonth.getTime() < now.getTime()) {
        errors.expiry = "有効期限が切れています。";
      }
    }
  }

  if (!/^\d{3,4}$/.test(card.cvc)) {
    errors.cvc = "セキュリティコードは 3〜4 桁の数字です。";
  }

  if (card.holder.trim() === "") {
    errors.holder = "カード名義を入力してください。";
  }

  return errors;
}
