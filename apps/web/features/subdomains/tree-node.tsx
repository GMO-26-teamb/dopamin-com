"use client";

import { Check, CircleDashed, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { SubdomainHost } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import {
  APPLY_STATUS_LABEL,
  APPLY_STATUS_TONE,
  PRIORITY_LABEL,
} from "./apply-status";

/**
 * Figma: Tree Node `54:33`
 * ホスト 1 件。ホスト名 + レコード種別 + 優先度 + 反映状態バッジ（FR-13）。
 * クリックすると右の編集パネル（S-43）の対象になる。
 */

const APPLY_STATUS_ICON: Record<SubdomainHost["applyStatus"], ReactNode> = {
  applied: <Check />,
  changed: <TriangleAlert />,
  pending: <CircleDashed />,
};

const PRIORITY_TONE: Record<SubdomainHost["priority"], "brand" | "neutral"> = {
  required: "brand",
  recommended: "neutral",
  optional: "neutral",
};

export interface TreeNodeProps {
  host: SubdomainHost;
  selected: boolean;
  onSelect: () => void;
}

export function TreeNode({ host, selected, onSelect }: TreeNodeProps) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "flex items-center gap-2 border-2 border-solid bg-panel px-2.5 py-1.5 text-left transition-colors hover:bg-hover",
        selected ? "border-brand-1" : "border-line",
      )}
      onClick={onSelect}
      type="button"
    >
      <span className="text-domain-sm text-ink">{host.host}</span>
      <Badge tone="muted">{host.recordType}</Badge>
      <Badge
        tone={PRIORITY_TONE[host.priority]}
        variant={host.priority === "required" ? "solid" : "outline"}
      >
        {PRIORITY_LABEL[host.priority]}
      </Badge>
      <Badge
        icon={APPLY_STATUS_ICON[host.applyStatus]}
        tone={APPLY_STATUS_TONE[host.applyStatus]}
      >
        {APPLY_STATUS_LABEL[host.applyStatus]}
      </Badge>
    </button>
  );
}
