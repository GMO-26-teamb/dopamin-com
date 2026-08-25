"use client";

import { DangerDialog } from "@/components/ui/dialog";
import type { DomainDetail } from "@/lib/api/types";
import {
  ADD_GRACE_PERIOD_DAYS,
  isWithinAddGracePeriod,
} from "../detail/derive";

/**
 * Figma: D-03 `83:3730`（Dialog / Danger）
 *
 * ドメイン名の再入力が一致するまで実行できない（要件 §15.2）。
 * AGP 内（登録後 5 日）は見出し・本文を「無課金で取消扱い」に切り替える（FR-10）。
 */
export interface DeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domain: DomainDetail;
  now: number;
  busy: boolean;
  onSubmit: () => void;
}

/** AGP 内 / 外の文言（D-03）。テストから直接検証できるよう純関数にしておく。 */
export function deleteCopy(name: string, withinAgp: boolean) {
  return withinAgp
    ? {
        title: `${name} を取り消しますか？`,
        subtitle: `登録から ${ADD_GRACE_PERIOD_DAYS} 日以内のため、無課金で取消扱いになります（Add Grace Period）。`,
        note: "取消後はドメインが即時に削除され、元に戻せません。ダッシュボードからも消えます。",
        primaryLabel: "取り消す",
      }
    : {
        title: `${name} を廃止しますか？`,
        subtitle: `登録から ${ADD_GRACE_PERIOD_DAYS} 日を過ぎているため、30 日間の復旧猶予（RGP）の後に完全に削除されます。`,
        note: "復旧猶予の間は「復旧」から戻せます（復旧費用はダミー表示）。削除ロック中は実行できません。",
        primaryLabel: "廃止する",
      };
}

export function DeleteDialog({
  open,
  onOpenChange,
  domain,
  now,
  busy,
  onSubmit,
}: DeleteDialogProps) {
  const copy = deleteCopy(domain.name, isWithinAddGracePeriod(domain, now));

  return (
    <DangerDialog
      busy={busy}
      confirmLabel="確認のためドメイン名を入力"
      confirmText={domain.name}
      note={copy.note}
      onOpenChange={onOpenChange}
      onPrimary={onSubmit}
      open={open}
      primaryLabel={busy ? "実行中…" : copy.primaryLabel}
      subtitle={copy.subtitle}
      title={copy.title}
    />
  );
}
