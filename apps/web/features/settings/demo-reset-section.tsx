"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardKicker } from "@/components/ui/card";
import { ErrorCard } from "@/components/ui/error-card";
import { useDemoReset } from "@/lib/api/hooks";
import { DemoResetDialog } from "./demo-reset-dialog";
import type { NotifySettings } from "./notice";

/**
 * Figma: S-70 `85:6709`（Card Warn kicker「デモデータリセット」）/ D-10 / S-71 `85:6884`
 * FR-16。`GET /auth/me` の `features.demoReset` が false のときは呼び出し側でカードごと出さない
 * （ui-screens §7-3 の仮置き）。
 */

/** S-71 のリセット完了バナー本文 */
const DONE_BODY =
  "デモ用ドメイン 4 件を投入しました（移管中サンプルは mock レジストリ）。ダッシュボードで確認できます。";

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
          tone: "ok",
          title: "デモデータをリセットしました",
          body: DONE_BODY,
        });
      },
      // 更新系の失敗は Error Card（code / HTTP / request ID）で出す（ui-screens §4）
      onError: () => setOpen(false),
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
          onClick={() => {
            demoReset.reset();
            setOpen(true);
          }}
          size="sm"
          variant="danger"
        >
          リセット実行
        </Button>
      </div>
      {demoReset.error ? <ErrorCard error={demoReset.error} /> : null}

      <DemoResetDialog
        busy={demoReset.isPending}
        onConfirm={handleConfirm}
        onOpenChange={setOpen}
        open={open}
      />
    </Card>
  );
}
