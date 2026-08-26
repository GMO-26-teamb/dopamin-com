"use client";

import type { OrderQuote } from "@dopamin/shared";
import { useCallback, useState } from "react";
import { usePayment } from "@/lib/api/hooks";
import type { PaymentCardInput, PaymentReceipt } from "@/lib/api/types";
import {
  type CardFieldErrors,
  DEMO_CARD,
  validateCard,
} from "@/lib/payments/card";
import type { PaymentFailure } from "./payment-step";

/**
 * お支払いステップの状態（カード入力・欄ごとのエラー・決済の拒否・進行中）。
 * 登録（S-29）と更新（D-11）のダイアログで共有する。
 *
 * `pay()` は 入力検証 → 決済モック の順に進め、レジストリ操作へ進んでよいときだけ
 * 控え（`PaymentReceipt`）を返す。それ以外は null（画面には errors / failure が立つ）。
 */
export interface PaymentStepState {
  card: PaymentCardInput;
  setCard: (card: PaymentCardInput) => void;
  errors: CardFieldErrors;
  failure: PaymentFailure | null;
  busy: boolean;
  pay: (quote: OrderQuote) => Promise<PaymentReceipt | null>;
  /** ダイアログを開き直すときに既定（デモ用カード）へ戻す */
  reset: () => void;
}

export function usePaymentStep(): PaymentStepState {
  const [card, setCardState] = useState<PaymentCardInput>(DEMO_CARD);
  const [errors, setErrors] = useState<CardFieldErrors>({});
  const [failure, setFailure] = useState<PaymentFailure | null>(null);
  const payment = usePayment();
  const { mutateAsync, reset: resetPayment, isPending } = payment;

  const setCard = useCallback((next: PaymentCardInput) => {
    setCardState(next);
    // 入力し直したら欄のエラーと前回の拒否は引っ込める
    setErrors({});
    setFailure(null);
  }, []);

  const reset = useCallback(() => {
    setCardState(DEMO_CARD);
    setErrors({});
    setFailure(null);
    resetPayment();
  }, [resetPayment]);

  const pay = useCallback(
    async (quote: OrderQuote): Promise<PaymentReceipt | null> => {
      const nextErrors = validateCard(card);
      setErrors(nextErrors);
      if (Object.keys(nextErrors).length > 0) {
        return null;
      }
      setFailure(null);
      try {
        const result = await mutateAsync({ quote, card });
        if (!result.ok) {
          setFailure({ code: result.code, message: result.message });
          return null;
        }
        return result.receipt;
      } catch (error) {
        setFailure({
          code: "PAYMENT_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "決済処理でエラーが発生しました。",
        });
        return null;
      }
    },
    [card, mutateAsync],
  );

  return { card, setCard, errors, failure, busy: isPending, pay, reset };
}
