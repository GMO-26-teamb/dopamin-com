"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { SubdomainHost } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import {
  PRIORITIES,
  PRIORITY_LABEL,
  RECORD_TYPE_OPTIONS,
  RECORD_TYPES,
} from "./apply-status";

/**
 * S-43 右パネル上段「〜 の編集」。ホスト名 / 用途 / レコード / 向き先 / 優先度を編集する。
 * 編集しただけでは DNS は変わらない（保存 → 反映の 2 段。FR-13）。
 */

function isRecordType(value: string): value is SubdomainHost["recordType"] {
  return (RECORD_TYPES as readonly string[]).includes(value);
}

export interface EditPanelProps {
  host: SubdomainHost;
  onChange: (host: SubdomainHost) => void;
  onRemove: () => void;
}

export function EditPanel({ host, onChange, onRemove }: EditPanelProps) {
  return (
    <div className="flex w-full flex-col gap-3">
      <p className="w-full text-heading-card text-ink">
        <span className="text-domain-sm">{host.host}</span> の編集
      </p>
      <Input
        autoComplete="off"
        label="ホスト名"
        monospace
        onChange={(event) => onChange({ ...host, host: event.target.value })}
        placeholder="www"
        surface="panel"
        value={host.host}
      />
      <Input
        autoComplete="off"
        label="用途"
        onChange={(event) => onChange({ ...host, purpose: event.target.value })}
        placeholder="メインサイト（apps/web）"
        surface="panel"
        value={host.purpose}
      />
      <div className="flex w-full items-start gap-3">
        <Select
          label="レコード"
          onValueChange={(value) => {
            if (isRecordType(value)) {
              onChange({ ...host, recordType: value });
            }
          }}
          options={RECORD_TYPE_OPTIONS}
          surface="panel"
          value={host.recordType}
        />
        <Input
          autoComplete="off"
          label="向き先"
          monospace
          onChange={(event) =>
            onChange({ ...host, target: event.target.value })
          }
          placeholder="cname.example.com"
          surface="panel"
          value={host.target}
        />
      </div>
      <div className="flex w-full items-center gap-1.5">
        {/* fieldset の暗黙ロールが group。3 択なので Segmented Control は使わない */}
        <fieldset
          aria-label="優先度"
          className="inline-flex shrink-0 items-center gap-1.5"
        >
          {PRIORITIES.map((priority) => {
            const selected = priority === host.priority;
            return (
              <button
                aria-pressed={selected}
                className={cn(
                  "inline-flex shrink-0 items-center px-2 py-0.5 text-label-xs transition-colors",
                  selected
                    ? "bg-[image:var(--gradient-brand)] text-on-brand"
                    : "border-[length:var(--stroke-medium)] border-muted border-solid text-muted hover:bg-hover",
                )}
                key={priority}
                onClick={() => onChange({ ...host, priority })}
                type="button"
              >
                {PRIORITY_LABEL[priority]}
              </button>
            );
          })}
        </fieldset>
        <span aria-hidden="true" className="min-w-0 flex-1" />
        <Button
          leadingIcon={<Trash2 />}
          onClick={onRemove}
          size="sm"
          variant="subtle"
        >
          このホストを削除
        </Button>
      </div>
    </div>
  );
}
