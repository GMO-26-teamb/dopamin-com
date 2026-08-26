"use client";

import { formatJpy, RESTORE_FEE } from "@dopamin/shared";
import { FormDialog } from "@/components/ui/dialog";
import type { DomainDetail } from "@/lib/api/types";
import { remainingDays } from "../format";

/**
 * Figma: D-04 `83:3826`（汎用 Dialog）
 * 費用（ダミー）と復旧後の状態を明示する（FR-11）。再入力は課さない。
 * 金額は `packages/shared` の固定ダミー価格（`RESTORE_FEE`）。決済ステップは持たない（FR-19 の対象外）。
 */
const RESTORE_FEE_LABEL = `${formatJpy(RESTORE_FEE)}（ダミー）`;

export interface RestoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domain: DomainDetail;
  now: number;
  busy: boolean;
  onSubmit: () => void;
}

export function RestoreDialog({
  open,
  onOpenChange,
  domain,
  now,
  busy,
  onSubmit,
}: RestoreDialogProps) {
  const remaining = remainingDays(domain.rgpUntil, now);

  return (
    <FormDialog
      busy={busy}
      onOpenChange={onOpenChange}
      onPrimary={onSubmit}
      open={open}
      primaryLabel={busy ? "復旧中…" : "復旧する"}
      title={`${domain.name} を復旧しますか？`}
    >
      <p className="w-full text-body-sm text-muted">
        復旧猶予（RGP）内のため復旧できます（残り {remaining} 日）。復旧費用{" "}
        {RESTORE_FEE_LABEL}が発生します。復旧後は Active
        に戻り、有効期限は元のままです。
      </p>
    </FormDialog>
  );
}
