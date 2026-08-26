import { formatJpy, type OrderQuote } from "@dopamin/shared";
import { Badge } from "@/components/ui/badge";
import { Card, Divider, KeyValueRow } from "@/components/ui/card";

/**
 * ui-screens S-29 / D-11 の「ご注文内容」。
 * 金額は `quoteOrder()`（packages/shared）の値をそのまま出し、ここで計算しない。
 */
export interface OrderSummaryProps {
  quote: OrderQuote;
}

const KIND_LABEL: Record<OrderQuote["kind"], string> = {
  register: "新規登録",
  renew: "更新（有効期限延長）",
};

export function OrderSummary({ quote }: OrderSummaryProps) {
  return (
    <Card kicker="ご注文内容">
      <KeyValueRow
        label="品目"
        value={
          <span className="inline-flex flex-wrap items-center justify-end gap-x-1.5">
            <span className="text-domain-sm">{quote.domain}</span>
            <span>{KIND_LABEL[quote.kind]}</span>
          </span>
        }
      />
      <KeyValueRow label="期間" value={`${quote.years} 年`} />
      <KeyValueRow label="単価" value={`${formatJpy(quote.unitPrice)} / 年`} />
      <Divider weight="thin" />
      <KeyValueRow label="小計" value={formatJpy(quote.subtotal)} />
      <KeyValueRow label="消費税（10%）" value={formatJpy(quote.tax)} />
      <Divider />
      <div className="flex w-full items-center justify-between gap-2">
        <span className="text-label text-ink">合計（税込）</span>
        <span className="text-heading-card text-ink" data-testid="order-total">
          {formatJpy(quote.total)}
        </span>
      </div>
      <Badge tone="muted">固定ダミー価格</Badge>
    </Card>
  );
}
