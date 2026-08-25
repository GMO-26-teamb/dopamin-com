"use client";

import { DangerDialog, FormDialog } from "@/components/ui/dialog";

/**
 * Figma: D-06 `83:4036`
 *
 * 承認は Dialog / Danger（ドメイン名の再入力で解錠、要件 §15.2）。
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
          拒否すると申請は取り消され、ドメインは手元に残ります。相手レジストラは再度申請できます。何もしない場合は{" "}
          {countdownLabel} 後に自動承認されます。
        </p>
        <p className="w-full text-caption text-muted">
          承認・拒否のどちらも操作ログに記録されます。
        </p>
      </FormDialog>
    );
  }

  return (
    <DangerDialog
      busy={busy}
      confirmLabel="確認のためドメイン名を入力"
      confirmText={domainName}
      note="拒否する場合は「拒否」から。承認・拒否のどちらも操作ログに記録されます（§15.2: 移管 OUT はドメイン名の再入力で確認）。"
      onOpenChange={onOpenChange}
      onPrimary={onSubmit}
      open={open}
      primaryLabel={busy ? "承認中…" : "承認する"}
      subtitle={`承認すると相手レジストラへ所有権が移り、保有一覧から消えます。この操作は取り消せません（何もしない場合は ${countdownLabel} 後に自動承認されます）。`}
      title={`${domainName} の移管を承認しますか？`}
    />
  );
}
