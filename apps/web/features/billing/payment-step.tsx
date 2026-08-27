"use client";

import type { OrderQuote } from "@dopamin/shared";
import { CreditCard } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Input } from "@/components/ui/input";
import type { PaymentCardInput } from "@/lib/api/types";
import {
  type CardFieldErrors,
  cardBrand,
  DECLINED_CARD_NUMBER,
  DEMO_CARD,
  formatCardNumber,
  formatExpiry,
} from "@/lib/payments/card";
import { OrderSummary } from "./order-summary";

/**
 * ui-screens S-29（登録）/ D-11（更新）のお支払いステップ（FR-19、モック決済）。
 *
 * ダイアログ本文だけを担当し、ボタン（「¥n を支払って登録する」/「戻る」）は
 * 親の `FormDialog` が持つ。状態は `use-payment-step.ts` に集約。
 */
export interface PaymentFailure {
  code: string;
  message: string;
}

export interface PaymentStepProps {
  quote: OrderQuote;
  card: PaymentCardInput;
  onCardChange: (card: PaymentCardInput) => void;
  errors: CardFieldErrors;
  failure: PaymentFailure | null;
  busy: boolean;
}

export function PaymentStep({
  quote,
  card,
  onCardChange,
  errors,
  failure,
  busy,
}: PaymentStepProps) {
  const brand = cardBrand(card.number);
  const isDemoCard = card.number === DEMO_CARD.number;

  return (
    <div className="flex w-full flex-col gap-3">
      <OrderSummary quote={quote} />

      <div className="flex w-full flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-label text-ink">
          <CreditCard aria-hidden="true" className="size-4" />
          お支払い方法
        </p>
        {isDemoCard ? (
          <Badge tone="brand">デモ用カード（入力済み）</Badge>
        ) : brand === null ? null : (
          <Badge tone="neutral">{brand}</Badge>
        )}
      </div>

      {failure === null ? null : (
        <Banner
          body={failure.message}
          title="お支払いに失敗しました"
          tone="warn"
        />
      )}

      <Input
        autoComplete="cc-number"
        disabled={busy}
        error={errors.number}
        helper={`${DEMO_CARD.number} は成功、${DECLINED_CARD_NUMBER} は失敗します`}
        inputMode="numeric"
        label="カード番号"
        monospace
        onChange={(event) =>
          onCardChange({
            ...card,
            number: formatCardNumber(event.target.value),
          })
        }
        placeholder="4242 4242 4242 4242"
        surface="panel"
        value={card.number}
      />
      <div className="flex w-full gap-3">
        <Input
          autoComplete="cc-exp"
          disabled={busy}
          error={errors.expiry}
          inputMode="numeric"
          label="有効期限"
          monospace
          onChange={(event) =>
            onCardChange({ ...card, expiry: formatExpiry(event.target.value) })
          }
          placeholder="MM/YY"
          surface="panel"
          value={card.expiry}
        />
        <Input
          autoComplete="cc-csc"
          disabled={busy}
          error={errors.cvc}
          inputMode="numeric"
          label="セキュリティコード"
          monospace
          onChange={(event) =>
            onCardChange({
              ...card,
              cvc: event.target.value.replace(/\D/g, "").slice(0, 4),
            })
          }
          placeholder="123"
          surface="panel"
          value={card.cvc}
        />
      </div>
      <Input
        autoComplete="cc-name"
        disabled={busy}
        error={errors.holder}
        label="カード名義"
        onChange={(event) =>
          onCardChange({ ...card, holder: event.target.value })
        }
        placeholder="TARO DOPAMIN"
        surface="panel"
        value={card.holder}
      />

      <p className="w-full text-caption text-muted">
        モック決済です。実際の請求は発生せず、カード情報はどこにも送信されません。
      </p>
    </div>
  );
}
