"use client";

import { DangerDialog } from "@/components/ui/dialog";

/**
 * D-10 デモリセットダイアログ（Figma `85:6801` / Dialog / Danger `85:6838`）。
 * 要件 §15.2 に従い「reset」の再入力が一致するまで「リセットする」は Disabled（FR-16）。
 */

/** 解錠に必要な入力（要件 §15.2） */
export const DEMO_RESET_CONFIRM_TEXT = "reset";

const SUBTITLE =
  "いまのドメイン・サブドメイン設計・ログを削除し、各状態のサンプル（Active・復旧猶予・期限間近・移管中）を再投入します。";
const NOTE = "この操作は取り消せません。";

export interface DemoResetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  busy?: boolean;
}

export function DemoResetDialog({
  open,
  onOpenChange,
  onConfirm,
  busy = false,
}: DemoResetDialogProps) {
  return (
    <DangerDialog
      busy={busy}
      confirmLabel={`確認のため「${DEMO_RESET_CONFIRM_TEXT}」と入力`}
      confirmText={DEMO_RESET_CONFIRM_TEXT}
      note={NOTE}
      onOpenChange={onOpenChange}
      onPrimary={onConfirm}
      open={open}
      primaryLabel="リセットする"
      subtitle={SUBTITLE}
      title="デモデータをリセットしますか？"
    />
  );
}
