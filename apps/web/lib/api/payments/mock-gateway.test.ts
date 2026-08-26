import { quoteOrder } from "@dopamin/shared";
import { describe, expect, it } from "vitest";
import { DECLINED_CARD_NUMBER, DEMO_CARD } from "@/lib/payments/card";
import { createMockPaymentService } from "./mock-gateway";

const quote = quoteOrder({
  kind: "register",
  domain: "takutaku.com",
  years: 2,
});
if (quote === null) {
  throw new Error("quote が作れません");
}

describe("createMockPaymentService", () => {
  it("デモ用カードは成功し、見積もりの合計と摘要を控えに載せる", async () => {
    const payments = createMockPaymentService({
      now: () => "2026-08-26T00:00:00.000Z",
      nonce: () => "ABCD1234",
    });
    const result = await payments.charge({ quote, card: DEMO_CARD });
    expect(result).toEqual({
      ok: true,
      receipt: {
        id: "pay_ABCD1234",
        paidAt: "2026-08-26T00:00:00.000Z",
        amount: quote.total,
        currency: "JPY",
        brand: "Visa",
        last4: "4242",
        description: "takutaku.com 新規登録 2 年",
      },
    });
  });

  it("末尾 0002 のカードは CARD_DECLINED を値で返す（例外にしない）", async () => {
    const payments = createMockPaymentService();
    const result = await payments.charge({
      quote,
      card: { ...DEMO_CARD, number: DECLINED_CARD_NUMBER },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CARD_DECLINED");
      expect(result.message).toMatch(/拒否/);
    }
  });

  it("更新の摘要は「更新」", async () => {
    const payments = createMockPaymentService();
    const renew = quoteOrder({ kind: "renew", domain: "a.xyz", years: 1 });
    if (renew === null) {
      throw new Error("quote が作れません");
    }
    const result = await payments.charge({ quote: renew, card: DEMO_CARD });
    expect(result.ok && result.receipt.description).toBe("a.xyz 更新 1 年");
  });
});
