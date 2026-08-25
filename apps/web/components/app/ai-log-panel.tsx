"use client";

import { ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorCard } from "@/components/ui/error-card";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { AiLogEntry } from "@/features/logs/ai-log-entry";
import { useAiLogs } from "@/lib/api/hooks";

/**
 * Figma: AI Log Panel `77:124`（画面 P-01）
 * 右 360px のドロワー。全画面から開けて、開いている間もメインは操作できる。
 * 0 件は Empty State、読み込み中は Skeleton（docs/specs/ui-screens.md §2.8 P-01）。
 */

const SKELETON_ROWS = 3;

export interface AiLogPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AiLogPanel({ open, onOpenChange }: AiLogPanelProps) {
  const logs = useAiLogs();

  return (
    <Sheet onOpenChange={onOpenChange} open={open} title="AI ログ">
      <div className="flex min-h-0 w-full flex-1 flex-col gap-3">
        <div className="flex w-full shrink-0 items-center gap-2">
          <Sparkles aria-hidden="true" className="size-4 shrink-0 text-ink" />
          <p className="min-w-0 flex-1 text-caption-sm text-muted">
            あなたの AI 呼び出しを時系列で表示。プロンプト全文ではなく要約 +
            構造化出力を保存
          </p>
          {logs.data === undefined ? null : (
            <Badge tone="muted">{logs.data.length}</Badge>
          )}
        </div>

        <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto">
          {logs.isPending ? (
            <div className="flex w-full flex-col gap-3 py-2">
              {Array.from({ length: SKELETON_ROWS }, (_, index) => (
                <Skeleton
                  // biome-ignore lint/suspicious/noArrayIndexKey: 並び順が固定のプレースホルダ
                  key={index}
                  shape="card"
                />
              ))}
            </div>
          ) : logs.error ? (
            <ErrorCard
              error={logs.error}
              onRetry={() => {
                void logs.refetch();
              }}
            />
          ) : logs.data.length === 0 ? (
            <EmptyState
              body="候補生成やサブドメイン提案を実行すると、ここに履歴が並びます。"
              icon={<Sparkles />}
              title="AI ログはまだありません"
            />
          ) : (
            <ul className="flex w-full flex-col">
              {logs.data.map((log) => (
                <li key={log.id}>
                  <AiLogEntry log={log} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <Button
          asChild
          className="shrink-0 self-start"
          size="sm"
          trailingIcon={<ArrowRight />}
          variant="subtle"
        >
          <Link href="/logs?tab=ai" onClick={() => onOpenChange(false)}>
            すべてのログを見る
          </Link>
        </Button>
      </div>
    </Sheet>
  );
}
