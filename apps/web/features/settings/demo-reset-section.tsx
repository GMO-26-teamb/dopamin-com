"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardKicker } from "@/components/ui/card";
import { useDemoReset } from "@/lib/api/hooks";
import { DemoResetDialog } from "./demo-reset-dialog";
import type { NotifySettings } from "./notice";

/**
 * Figma: S-70 `85:6709`（Card Warn kicker「デモデータリセット」）/ D-10 / S-71 `85:6884`
 * FR-16。`GET /auth/me` の `features.demoReset` が false のときは呼び出し側でカードごと出さない
 * （ui-screens §7-3 の仮置き）。
 *
 * 何が起きるかは D-10 の subtitle に 1 度だけ書く。ここと完了 Banner は繰り返さない。
 */

export interface DemoResetSectionProps {
  onNotify: NotifySettings;
  className?: string;
}

export function DemoResetSection({
  onNotify,
  className,
}: DemoResetSectionProps) {
  const demoReset = useDemoReset();
  const [open, setOpen] = useState(false);

  const handleConfirm = () => {
    demoReset.mutate(undefined, {
      onSuccess: () => {
        setOpen(false);
        onNotify({
          kind: "banner",
          tone: "ok",
          title: "デモデータをリセットしました",
          body: "ダッシュボードで確認できます。",
        });
      },
      // 更新系の失敗は Error Card（code / HTTP / request ID）で出す（ui-screens §4）
      onError: (error) => {
        setOpen(false);
        onNotify({ kind: "error", error });
      },
    });
  };

  return (
    <Card className={className} emphasis="warn">
      <CardKicker className="text-warn">デモデータリセット</CardKicker>
      <div className="flex w-full items-center justify-between gap-2">
        <p className="min-w-0 text-caption text-muted">
          各状態のサンプルを再投入
        </p>
        <Button
          leadingIcon={<Trash2 />}
          onClick={() => {
            onNotify(null);
            demoReset.reset();
            setOpen(true);
          }}
          size="sm"
          variant="danger"
        >
          デモデータをリセット
        </Button>
      </div>

      <DemoResetDialog
        busy={demoReset.isPending}
        onConfirm={handleConfirm}
        onOpenChange={setOpen}
        open={open}
      />
    </Card>
  );
}
