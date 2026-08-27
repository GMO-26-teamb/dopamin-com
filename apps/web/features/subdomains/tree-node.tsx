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
 * ホスト 1 件。ホスト名 + 優先度 + 反映状態（FR-13）。
 * クリックすると右の編集パネル（S-43）の対象になる。
 *
 * バッジは優先度の 1 枚だけにする。反映状態は色付きの記号（読み上げ用のテキスト付き）で足り、
 * レコード種別は選ぶと編集パネルに出るので、ノードでは重ねて見せない。
 */

const APPLY_STATUS_ICON: Record<SubdomainHost["applyStatus"], ReactNode> = {
  applied: <Check />,
  changed: <TriangleAlert />,
  pending: <CircleDashed />,
};

/** `APPLY_STATUS_TONE` の Tone を記号の色に写す（バッジと同じ意味づけ）。 */
const TONE_TEXT: Record<"ok" | "warn" | "muted", string> = {
  ok: "text-ok",
  warn: "text-warn",
  muted: "text-muted",
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
      <Badge
        tone={PRIORITY_TONE[host.priority]}
        variant={host.priority === "required" ? "solid" : "outline"}
      >
        {PRIORITY_LABEL[host.priority]}
      </Badge>
      <span
        className={cn(
          "inline-flex size-3.5 shrink-0 items-center justify-center",
          TONE_TEXT[APPLY_STATUS_TONE[host.applyStatus]],
        )}
      >
        <span
          aria-hidden="true"
          className="inline-flex size-full [&_svg]:size-full"
        >
          {APPLY_STATUS_ICON[host.applyStatus]}
        </span>
        <span className="sr-only">{APPLY_STATUS_LABEL[host.applyStatus]}</span>
      </span>
    </button>
  );
}
