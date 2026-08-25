"use client";

/**
 * Figma: D-08 `85:6029`（移管取消ダイアログ）
 *
 * 自分の移管 IN 申請を、相手レジストラの承認前に取り消す（FR-12 / `transferCancel`）。
 * 「取り消す」→ S-50 に戻り Banner Ok を出す（ui-screens §3）。
 */

import type { Transfer } from "@/lib/api/types";
import { ConfirmDialog } from "./confirm-dialog";

export interface CancelTransferDialogProps {
  transfer: Transfer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy?: boolean;
  onConfirm: (transfer: Transfer) => void;
}

export function CancelTransferDialog({
  transfer,
  open,
  onOpenChange,
  busy = false,
  onConfirm,
}: CancelTransferDialogProps) {
  if (transfer === null) {
    return null;
  }

  return (
    <ConfirmDialog
      body="相手レジストラの承認前なら取り消せます（transferCancel）。取り消し後に再申請するには AuthCode の再発行が必要な場合があります。"
      busy={busy}
      busyLabel="取り消し中…"
      onOpenChange={onOpenChange}
      onPrimary={() => onConfirm(transfer)}
      open={open}
      primaryLabel="取り消す"
      title={`${transfer.domainName} の移管申請を取り消しますか？`}
    />
  );
}
