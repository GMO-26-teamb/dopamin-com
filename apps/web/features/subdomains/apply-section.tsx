"use client";

import { Check, TriangleAlert, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardKicker, KeyValueRow } from "@/components/ui/card";
import type { DnsDiff } from "@/lib/api/types";
import {
  type ApplyCounts,
  applyStatusSummary,
  diffTotal,
} from "./apply-status";

/**
 * S-43 右パネル下段「DNS 反映」。NS の状態・反映状況・反映 CTA（S-45 では Disabled）。
 * 反映先はアプリ内の疑似 DNS ゾーンで、実インターネットの名前解決には関与しない（FR-13）。
 */

const APPLY_NOTE =
  "反映前に追加 / 変更 / 削除の差分を確認します。反映はアプリ内の DNS ゾーンに対して行われます";
const DIRTY_NOTE = "未保存の変更があります。先に「設計を保存」してください。";

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
  } else if (diffPending) {
    label = "差分を確認中…";
  } else if (diffFailed) {
    label = "差分を取得できませんでした";
  } else if (noChanges) {
    label = "反映済み — 差分なし";
  } else if (total !== null) {
    label = `DNS に反映（差分 ${total} 件）`;
  }

  return (
    <section className="flex w-full flex-col gap-2">
      <CardKicker>DNS 反映</CardKicker>
      <div className="flex w-full items-center justify-between gap-2 text-body-sm">
        <span className="shrink-0 text-muted">ネームサーバー</span>
        {nameserversSwitched ? (
          <Badge icon={<Check />} tone="ok">
            ドパ民 DNS に切替済み
          </Badge>
        ) : (
          <Badge icon={<TriangleAlert />} tone="warn">
            未切替 — 反映時に切り替えます
          </Badge>
        )}
      </div>
      <KeyValueRow label="反映状況" value={applyStatusSummary(counts)} />
      <Button
        className="w-full justify-center"
        disabled={disabled}
        leadingIcon={noChanges && !diffFailed ? <Check /> : <Zap />}
        loading={applying}
        onClick={onApply}
        variant={disabled ? "subtle" : "primary"}
      >
        {label}
      </Button>
      <p className="w-full text-caption text-muted">
        {dirty ? DIRTY_NOTE : APPLY_NOTE}
      </p>
    </section>
  );
}
