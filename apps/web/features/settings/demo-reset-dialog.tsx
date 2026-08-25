"use client";

import { DangerDialog } from "@/components/ui/dialog";

/**
 * D-10 デモリセットダイアログ（Figma `85:6801` / Dialog / Danger `85:6838`）。
 * 要件 §15.2 に従い「reset」の再入力が一致するまで「リセット実行」は Disabled（FR-16）。
 */

/** 解錠に必要な入力（要件 §15.2） */
export const DEMO_RESET_CONFIRM_TEXT = "reset";

const SUBTITLE =
  "あなたのドメイン・設計・ログを削除し、各状態のサンプル（Active / RGP / 期限間近 / 移管中）を再投入します。";
const NOTE =
  "DEMO_RESET_ENABLED=true の環境でのみ実行できます。レジストリ側の状態は戻せないため、デモ用ドメインは dopamin-demo-* として実登録するか mock レジストリに紐付けます。";

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
      primaryLabel="リセット実行"
      subtitle={SUBTITLE}
      title="デモデータをリセットしますか？"
    />
  );
}
