"use client";

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

/**
 * D-09 パスキー削除ダイアログ（Figma `85:6745`）。
 *
 * 汎用 Dialog（ui-screens §2.8）。破壊的操作の再入力が要るのはドメイン廃止 / デモリセット /
 * 移管 OUT の承認だけなので（§5）、ここは確認テキストの入力を課さない。
 * 最後の 1 つは呼び出し側が Disabled にする（理由はそのボタンのアクセシブルネームだけに置く）。
 * 競合で API が 409 を返したときはダイアログを閉じて呼び出し側が Error Card を出す
 * （§4 の CONFLICT 行）。
 */
export interface DeletePasskeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 削除対象の表示名 */
  passkeyName: string;
  onConfirm: () => void;
  busy?: boolean;
}

export function DeletePasskeyDialog({
  open,
  onOpenChange,
  passkeyName,
  onConfirm,
  busy = false,
}: DeletePasskeyDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>パスキーを削除しますか？</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          {passkeyName} のパスキーを削除します。
        </DialogDescription>
        <DialogFooter>
          <DialogClose asChild>
            <Button disabled={busy} variant="subtle">
              キャンセル
            </Button>
          </DialogClose>
          <Button loading={busy} onClick={onConfirm} variant="solid">
            削除する
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
