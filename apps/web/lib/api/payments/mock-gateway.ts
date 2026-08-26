import { cardBrand, cardDigits, cardLast4 } from "@/lib/payments/card";
import type { PaymentService } from "../services";
import type { PaymentChargeInput, PaymentResult } from "../types";

/**
 * 決済モック（FR-19）。決済代行（PSP）の SDK に相当する層をブラウザ内で完結させる。
 *
 * - 実 PSP には接続しない。`http` モードでも同じモックを使う（API にも決済ルートは無い）。
 * - 成功 / 失敗はカード番号で決める（Stripe のテスト番号に倣い、末尾 `0002` は拒否）。
 * - 金額は `packages/shared` の `quoteOrder()` が出した見積もりをそのまま使う。
 *
 * 実決済を入れるときはこのファイルを PSP クライアントに差し替え、`PaymentService` の
 * 契約（`charge` → `PaymentResult`）は変えない。
 */

/** この末尾 4 桁で終わる番号は「カード会社に拒否された」を返す。 */
const DECLINED_SUFFIX = "0002";

export interface MockPaymentGatewayOptions {
  /** 決済中の演出（ms）。テストは 0。 */
  delayMs?: number;
  /** 受付時刻（テストで固定するため注入可） */
  now?: () => string;
  /** 受付番号の乱数部（テストで固定するため注入可） */
  nonce?: () => string;
}

function delay(ms: number): Promise<void> {
  return ms <= 0
    ? Promise.resolve()
    : new Promise((resolve) => setTimeout(resolve, ms));
}

function randomNonce(): string {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

export function createMockPaymentService(
  options: MockPaymentGatewayOptions = {},
): PaymentService {
  const delayMs = options.delayMs ?? 0;
  const now = options.now ?? (() => new Date().toISOString());
  const nonce = options.nonce ?? randomNonce;

  return {
    async charge(input: PaymentChargeInput): Promise<PaymentResult> {
      await delay(delayMs);
      const digits = cardDigits(input.card.number);
      if (digits.endsWith(DECLINED_SUFFIX)) {
        return {
          ok: false,
          code: "CARD_DECLINED",
          message:
            "カード会社に支払いを拒否されました。別のカードでお試しください。",
        };
      }
      return {
        ok: true,
        receipt: {
          id: `pay_${nonce()}`,
          paidAt: now(),
          amount: input.quote.total,
          currency: input.quote.currency,
          brand: cardBrand(input.card.number) ?? "Card",
          last4: cardLast4(input.card.number),
          description: describeQuote(input.quote),
        },
      };
    },
  };
}

/** 領収の摘要（例 `takutaku.com 新規登録 2 年`）。 */
function describeQuote(quote: PaymentChargeInput["quote"]): string {
  const kind = quote.kind === "register" ? "新規登録" : "更新";
  return `${quote.domain} ${kind} ${quote.years} 年`;
}
