"use client";

import { formatJpy, quoteOrder } from "@dopamin/shared";
import { useEffect, useState } from "react";
import { FormDialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { PaymentStep } from "@/features/billing/payment-step";
import { usePaymentStep } from "@/features/billing/use-payment-step";
import type { DomainDetail, PaymentReceipt } from "@/lib/api/types";
import {
  MAX_REGISTRATION_YEARS,
  maxRenewPeriod,
  renewedExpiry,
} from "../detail/derive";
import { formatDate } from "../format";

/**
 * Figma: D-01 `83:3496`（Dialog / Form）
 * 期間 Select + Helper に新しい有効期限。合計 10 年超は送信前に弾く（AC-08-2）。
 * 「お支払いへ」→ お支払いステップ（D-11、モック決済）→ 決済成功で `onSubmit`（renew）。
 */
export interface RenewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domain: DomainDetail;
  now: number;
  busy: boolean;
  onSubmit: (period: number, receipt: PaymentReceipt) => void;
}

type Step = "form" | "payment";

export function RenewDialog({
  open,
  onOpenChange,
  domain,
  now,
  busy,
  onSubmit,
}: RenewDialogProps) {
  const max = maxRenewPeriod(domain.expiresAt, now);
  const [period, setPeriod] = useState("1");
  const [step, setStep] = useState<Step>("form");
  const payment = usePaymentStep();
  const { reset: resetPayment } = payment;

  // 開くたびに既定値へ戻す（前回の選択・カード入力を持ち越さない）
  useEffect(() => {
    if (open) {
      setPeriod("1");
      setStep("form");
      resetPayment();
    }
  }, [open, resetPayment]);

  const options = Array.from({ length: max }, (_, index) => ({
    value: String(index + 1),
    label: `${index + 1} 年`,
  }));
  const selected = Number(period);
  const quote =
    max === 0
      ? null
      : quoteOrder({ kind: "renew", domain: domain.name, years: selected });
  const helper =
    max === 0
      ? `合計有効期間が上限（${MAX_REGISTRATION_YEARS} 年）に達しているため延長できません。`
      : `新しい有効期限: ${renewedExpiry(domain.expiresAt, selected)}（合計 ${MAX_REGISTRATION_YEARS} 年まで）${quote === null ? "" : `・お支払い合計 ${formatJpy(quote.total)}`}`;

  const handlePrimary = async () => {
    if (quote === null) {
      return;
    }
    if (step === "form") {
      setStep("payment");
      return;
    }
    const receipt = await payment.pay(quote);
    if (receipt === null) {
      return;
    }
    onSubmit(selected, receipt);
  };

  const isPayment = step === "payment";
  const working = busy || payment.busy;

  return (
    <FormDialog
      busy={working}
      onOpenChange={onOpenChange}
      onPrimary={handlePrimary}
      onSecondary={isPayment ? () => setStep("form") : undefined}
      open={open}
      primaryDisabled={max === 0 || quote === null}
      primaryLabel={
        isPayment && quote !== null
          ? busy
            ? "延長中…"
            : `${formatJpy(quote.total)} を支払って延長する`
          : "お支払いへ"
      }
      secondaryLabel={isPayment ? "戻る" : "キャンセル"}
      subtitle={
        isPayment
          ? `${domain.name}・お支払い（モック決済・実際の請求はありません）`
          : `${domain.name}・現在の有効期限 ${formatDate(domain.expiresAt)}`
      }
      title="有効期限を延長"
    >
      {isPayment && quote !== null ? (
        <PaymentStep
          busy={working}
          card={payment.card}
          errors={payment.errors}
          failure={payment.failure}
          onCardChange={payment.setCard}
          quote={quote}
        />
      ) : (
        <Select
          disabled={max === 0}
          helper={helper}
          label="延長する期間"
          onValueChange={setPeriod}
          options={max === 0 ? [{ value: "1", label: "—" }] : options}
          surface="panel"
          value={period}
        />
      )}
    </FormDialog>
  );
}
