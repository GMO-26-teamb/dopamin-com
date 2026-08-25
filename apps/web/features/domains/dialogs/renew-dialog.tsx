"use client";

import { useEffect, useState } from "react";
import { FormDialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import type { DomainDetail } from "@/lib/api/types";
import {
  formatDate,
  MAX_REGISTRATION_YEARS,
  maxRenewPeriod,
  renewedExpiry,
} from "../detail/derive";

/**
 * Figma: D-01 `83:3496`（Dialog / Form）
 * 期間 Select + Helper に新しい有効期限。合計 10 年超は送信前に弾く（AC-08-2）。
 */
export interface RenewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domain: DomainDetail;
  now: number;
  busy: boolean;
  onSubmit: (period: number) => void;
}

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

  // 開くたびに既定値へ戻す（前回の選択を持ち越さない）
  useEffect(() => {
    if (open) {
      setPeriod("1");
    }
  }, [open]);

  const options = Array.from({ length: max }, (_, index) => ({
    value: String(index + 1),
    label: `${index + 1} 年`,
  }));
  const selected = Number(period);
  const helper =
    max === 0
      ? `合計有効期間が上限（${MAX_REGISTRATION_YEARS} 年）に達しているため延長できません。`
      : `新しい有効期限: ${renewedExpiry(domain.expiresAt, selected)}（合計 ${MAX_REGISTRATION_YEARS} 年まで）`;

  return (
    <FormDialog
      busy={busy}
      onOpenChange={onOpenChange}
      onPrimary={() => onSubmit(selected)}
      open={open}
      primaryDisabled={max === 0}
      primaryLabel={busy ? "延長中…" : "延長する"}
      subtitle={`${domain.name}・現在の有効期限 ${formatDate(domain.expiresAt)}`}
      title="有効期限を延長"
    >
      <Select
        disabled={max === 0}
        helper={helper}
        label="延長する期間"
        onValueChange={setPeriod}
        options={max === 0 ? [{ value: "1", label: "—" }] : options}
        surface="panel"
        value={period}
      />
    </FormDialog>
  );
}
