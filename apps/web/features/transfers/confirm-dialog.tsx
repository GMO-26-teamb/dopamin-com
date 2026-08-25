"use client";

/**
 * Figma: Dialog `53:10`（D-08 `85:6029`）
 *
 * 再入力を伴わない確認ダイアログ（移管の取消 / 拒否）。本文を
 * `DialogDescription` で出すので radix が `aria-describedby` を張る。
 * 破壊的操作（移管 OUT の承認）は再入力が要るので `DangerDialog` を使う（§15.2）。
 */

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  primaryLabel: string;
  busyLabel: string;
  busy?: boolean;
  onPrimary: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  primaryLabel,
  busyLabel,
  busy = false,
  onPrimary,
}: ConfirmDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogDescription>{body}</DialogDescription>
        <DialogFooter>
          <DialogClose asChild>
            <Button disabled={busy} variant="subtle">
              キャンセル
            </Button>
          </DialogClose>
          <Button
            disabled={busy}
            loading={busy}
            onClick={onPrimary}
            variant="solid"
          >
            {busy ? busyLabel : primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
