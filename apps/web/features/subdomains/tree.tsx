"use client";

import { Plus } from "lucide-react";
import type { SubdomainHost } from "@/lib/api/types";
import { TreeNode } from "./tree-node";

/**
 * Figma: Tree Root `54:37` + Tree Node `54:33`
 * S-43 左半分の設計ツリー。ルート（ドメイン名）からホストがぶら下がる。
 */

export interface PlanTreeProps {
  domain: string;
  hosts: readonly SubdomainHost[];
  selectedId: string | null;
  /** 上限（契約は 1〜8 件）に達したら追加ボタンを止める。既定は追加できる。 */
  canAdd?: boolean;
  onSelect: (id: string) => void;
  onAddHost: () => void;
}

export function PlanTree({
  domain,
  hosts,
  selectedId,
  canAdd = true,
  onSelect,
  onAddHost,
}: PlanTreeProps) {
  return (
    <div className="flex w-full flex-col items-start">
      <p className="border-2 border-ink border-solid bg-panel px-3 py-2 text-domain-card text-ink">
        {domain}
      </p>
      {/* 縦の枝。各行は横のコネクタでノードにつながる */}
      <ul className="mt-2 flex w-full flex-col gap-2 border-line border-l-2 pl-0">
        {hosts.map((host) => (
          <li className="flex items-center" key={host.id}>
            <span aria-hidden="true" className="h-0.5 w-5 shrink-0 bg-line" />
            <TreeNode
              host={host}
              onSelect={() => onSelect(host.id)}
              selected={host.id === selectedId}
            />
          </li>
        ))}
        <li className="flex items-center">
          <span aria-hidden="true" className="h-0.5 w-5 shrink-0 bg-line" />
          <button
            className="inline-flex items-center gap-1.5 border-2 border-soft border-dashed bg-panel px-2.5 py-1.5 text-label-sm text-muted transition-colors hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-[var(--opacity-disabled)] disabled:hover:bg-panel disabled:hover:text-muted"
            disabled={!canAdd}
            onClick={onAddHost}
            type="button"
          >
            <Plus aria-hidden="true" className="size-3.5 shrink-0" />
            ホストを追加
          </button>
        </li>
      </ul>
    </div>
  );
}
