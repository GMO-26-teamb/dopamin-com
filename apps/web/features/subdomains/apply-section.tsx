"use client";

import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardKicker, KeyValueRow } from "@/components/ui/card";
import type { DnsDiff } from "@/lib/api/types";
import {
  type ApplyCounts,
  applyStatusSummary,
  diffTotal,
} from "./apply-status";
import { NameserverBadge } from "./nameserver-badge";

/**
 * S-43「DNS 反映」。ツリー / 編集パネルの下に置く全体セクション。
 * ここが画面唯一の Primary（`components/ui/button.tsx`「Primary は 1 画面 1 つ」）。
 *
 * ボタンのラベルは常に動作名にする。押せない理由（未保存 / 差分の読み込み失敗 / 差分なし）は
 * ボタンではなく「反映状況」行と補足の 1 文で伝える。
 * 反映先はアプリ内の疑似 DNS ゾーンで、実インターネットの名前解決には関与しない（FR-13）。
 */

const APPLY_NOTE = "反映先はアプリ内の DNS ゾーンです。";
const DIRTY_NOTE = "未保存の変更があります。先に設計を保存してください。";
const PENDING_NOTE = "差分を確認しています。";
const FAILED_NOTE = "差分を読み込めませんでした。";

export interface ApplySectionProps {
  counts: ApplyCounts;
  nameserversSwitched: boolean;
  diff: DnsDiff | undefined;
  diffPending: boolean;
  diffFailed: boolean;
  /** 保存していない編集がある間は反映できない（反映対象は保存済み設計） */
  dirty: boolean;
  applying: boolean;
  onApply: () => void;
}

export function ApplySection({
  counts,
  nameserversSwitched,
  diff,
  diffPending,
  diffFailed,
  dirty,
  applying,
  onApply,
}: ApplySectionProps) {
  const total = diff === undefined ? null : diffTotal(diff);
  const noChanges = total === 0;
  const disabled = dirty || diffPending || diffFailed || noChanges || applying;

  let label = "DNS に反映";
  if (applying) {
    label = "反映中…";
  } else if (total !== null && total > 0) {
    label = `DNS に反映（差分 ${total} 件）`;
  }

  let note = APPLY_NOTE;
  if (dirty) {
    note = DIRTY_NOTE;
  } else if (diffFailed) {
    note = FAILED_NOTE;
  } else if (diffPending) {
    note = PENDING_NOTE;
  }
  // 差分 0 件の理由は「反映状況」行（…・差分なし）が言うので、ここでは繰り返さない

  return (
    <section className="flex w-full flex-col gap-3 border-2 border-line border-solid bg-panel px-4 py-3">
      <CardKicker>DNS 反映</CardKicker>
      <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-start sm:gap-6">
        <div className="min-w-0 flex-1 sm:max-w-95">
          <NameserverBadge switched={nameserversSwitched} />
        </div>
        <div className="min-w-0 flex-1 sm:max-w-95">
          <KeyValueRow label="反映状況" value={applyStatusSummary(counts)} />
        </div>
      </div>
      <div className="flex w-full flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
        <Button
          className="shrink-0"
          disabled={disabled}
          leadingIcon={<Zap />}
          loading={applying}
          onClick={onApply}
          variant={disabled ? "subtle" : "primary"}
        >
          {label}
        </Button>
        <p className="min-w-0 text-caption text-muted">{note}</p>
      </div>
    </section>
  );
}
