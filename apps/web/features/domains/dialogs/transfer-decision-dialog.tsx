"use client";

import { DangerDialog, FormDialog } from "@/components/ui/dialog";

/**
 * Figma: D-06 `83:4036`
 *
 * 承認は Dialog / Danger（ドメイン名の再入力で解錠）。
 * 拒否は汎用 Dialog（再入力なし）。どちらも本文に自動承認までの残り時間を出す。
 */
export type TransferDecision = "approve" | "reject";

export interface TransferDecisionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  decision: TransferDecision;
  domainName: string;
  /** 自動承認までの残り（`mm:ss`）。 */
  countdownLabel: string;
  busy: boolean;
  onSubmit: () => void;
}

export function TransferDecisionDialog({
  open,
  onOpenChange,
  decision,
  domainName,
  countdownLabel,
  busy,
  onSubmit,
}: TransferDecisionDialogProps) {
  if (decision === "reject") {
    return (
      <FormDialog
        busy={busy}
        onOpenChange={onOpenChange}
        onPrimary={onSubmit}
        open={open}
        primaryLabel={busy ? "拒否中…" : "拒否する"}
        primaryVariant="solid"
        title={`${domainName} の移管を拒否しますか？`}
      >
        <p className="w-full text-body-sm text-muted">
          拒否するとドメインは手元に残ります。相手レジストラは再度申請できます。
        </p>
        <p className="w-full text-caption text-muted">
          何もしない場合は {countdownLabel} 後に自動承認されます。
        </p>
      </FormDialog>
    );
  }

  return (
    <DangerDialog
      busy={busy}
      confirmLabel="確認のためドメイン名を入力"
      confirmText={domainName}
      note={`何もしない場合は ${countdownLabel} 後に自動承認されます。手元に残すなら「拒否」を選んでください。`}
      onOpenChange={onOpenChange}
      onPrimary={onSubmit}
      open={open}
      primaryLabel={busy ? "承認中…" : "承認する"}
      subtitle="承認すると所有権が相手レジストラへ移り、保有一覧から消えます。取り消せません。"
      title={`${domainName} の移管を承認しますか？`}
    />
  );
}
