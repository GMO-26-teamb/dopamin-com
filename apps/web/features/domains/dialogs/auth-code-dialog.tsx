"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorCard } from "@/components/ui/error-card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ApiClientError } from "@/lib/api/errors";

/**
 * Figma: D-05 `83:3954`（Dialog / Form + Code Block）
 *
 * 開いた時点で `rotate-auth-info` により発行し、「再発行」で発行し直す（FR-12）。
 * ドメイン名の再入力は課さない（ui-screens §7-4 の仮置き）。値は保存せず、
 * 操作ログではマスクされる。
 */
export interface AuthCodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domainName: string;
  authCode: string | null;
  busy: boolean;
  error: ApiClientError | null;
  /** 発行 / 再発行。開いたときにも呼ぶ。 */
  onIssue: () => void;
}

export function AuthCodeDialog({
  open,
  onOpenChange,
  domainName,
  authCode,
  busy,
  error,
  onIssue,
}: AuthCodeDialogProps) {
  // 開いた時点で 1 回だけ発行する（開き直すたびに新しい値になる）。
  // `onIssue` の同一性に関わらず 1 回に留めたいので ref で見張る。
  const issuedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      issuedRef.current = false;
      return;
    }
    if (issuedRef.current) {
      return;
    }
    issuedRef.current = true;
    onIssue();
  }, [open, onIssue]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>AuthCode を発行</DialogTitle>
          <DialogDescription variant="subtitle">
            {domainName} を他社へ移管するためのコードです。
          </DialogDescription>
        </DialogHeader>

        {error !== null ? (
          <ErrorCard error={error} onRetry={onIssue} showLogsLink />
        ) : busy || authCode === null ? (
          <Skeleton className="h-12" shape="block" />
        ) : (
          <CodeBlock code={authCode} />
        )}

        <p className="w-full text-caption text-muted">
          このコードを相手レジストラの移管申請に貼り付けてください。再発行すると以前のコードは使えなくなります。
        </p>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="subtle">閉じる</Button>
          </DialogClose>
          <Button
            leadingIcon={<RefreshCw />}
            loading={busy}
            onClick={onIssue}
            variant="primary"
          >
            {busy ? "発行中…" : "再発行"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
