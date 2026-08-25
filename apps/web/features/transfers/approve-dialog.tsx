"use client";

/**
 * Figma: Dialog / Danger `76:360`（D-06 `83:4036` と同型）
 *
 * 受信した移管 OUT 申請の承認 / 拒否（FR-12 / AC-12-4）。
 * 承認は所有権が相手に移る破壊的操作なので、ドメイン名の再入力で解錠する（要件 §15.2）。
 * 拒否は再入力なしの汎用ダイアログ。
 */

import { DangerDialog } from "@/components/ui/dialog";
import type { Transfer } from "@/lib/api/types";
import { ConfirmDialog } from "./confirm-dialog";

export interface TransferDecisionDialogProps {
  transfer: Transfer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy?: boolean;
  onConfirm: (transfer: Transfer) => void;
}

export function ApproveTransferDialog({
  transfer,
  open,
  onOpenChange,
  busy = false,
  onConfirm,
}: TransferDecisionDialogProps) {
  if (transfer === null) {
    return null;
  }

  return (
    <DangerDialog
      busy={busy}
      confirmLabel="確認のためドメイン名を入力"
      confirmText={transfer.domainName}
      note="承認するとこのドメインは相手レジストラに移り、保有一覧から外れます。承認後は取り消せません。"
      onOpenChange={onOpenChange}
      onPrimary={() => onConfirm(transfer)}
      open={open}
      primaryLabel={busy ? "承認中…" : "承認する"}
      primaryVariant="solid"
      subtitle="移管 OUT（FR-12）"
      title={`${transfer.domainName} の移管を承認しますか？`}
    />
  );
}

export function RejectTransferDialog({
  transfer,
  open,
  onOpenChange,
  busy = false,
  onConfirm,
}: TransferDecisionDialogProps) {
  if (transfer === null) {
    return null;
  }

  return (
    <ConfirmDialog
      body="拒否すると相手レジストラの申請は取り下げられ、ドメインは自分の保有のままになります。自動承認までに操作しないと、サーバが自動で承認します。"
      busy={busy}
      busyLabel="拒否中…"
      onOpenChange={onOpenChange}
      onPrimary={() => onConfirm(transfer)}
      open={open}
      primaryLabel="拒否する"
      title={`${transfer.domainName} の移管申請を拒否しますか？`}
    />
  );
}
