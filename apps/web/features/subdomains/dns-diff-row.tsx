"use client";

import { Badge } from "@/components/ui/badge";

/**
 * Figma: DNS Diff Row `73:188`
 * S-44 の 1 行。種別バッジ + ホスト名 + 反映後のレコード（変更は旧値も添える）。
 */

export type DiffKind = "added" | "updated" | "removed";

const KIND_LABEL: Record<DiffKind, string> = {
  added: "追加",
  updated: "変更",
  removed: "削除",
};

const KIND_TONE: Record<DiffKind, "neutral" | "warn"> = {
  added: "neutral",
  updated: "warn",
  removed: "warn",
};

export interface DnsDiffRowProps {
  kind: DiffKind;
  host: string;
  /** 反映後のレコード（削除の行は反映前の値） */
  record: string;
  /** 変更の行だけ「旧: …」を出す */
  previous?: string;
}

export function DnsDiffRow({ kind, host, record, previous }: DnsDiffRowProps) {
  return (
    <div className="flex w-full items-start gap-2 py-1.5">
      <Badge className="mt-0.5" tone={KIND_TONE[kind]}>
        {KIND_LABEL[kind]}
      </Badge>
      <span className="w-20 shrink-0 text-domain-sm text-ink">{host}</span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-code text-ink">{record}</span>
        {previous === undefined ? null : (
          <span className="text-code text-muted">旧: {previous}</span>
        )}
      </div>
    </div>
  );
}
