"use client";

import { Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Divider } from "@/components/ui/card";
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
import type { DnsDiff } from "@/lib/api/types";
import { diffTotal, recordText } from "./apply-status";
import { DnsDiffRow } from "./dns-diff-row";
import { NameserverBadge } from "./nameserver-badge";

/**
 * Figma: Dialog / Apply DNS `73:192`（S-44）
 * 反映前の差分確認（AC-13-7）。件数チップ → 差分行 → NS 状態 →「n 件を反映する」。
 * キャンセル / Esc では何も変更しない。
 */

const APPLY_NOTE =
  "取り消すには設計を編集して再反映します。実インターネットの名前解決には影響しません。";

/** 0 件のチップは目立たせない（Figma の「削除 0」）。 */
function countTone(
  count: number,
  tone: "neutral" | "warn",
): "neutral" | "warn" | "muted" {
  return count > 0 ? tone : "muted";
}

export interface ApplyDnsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domain: string;
  diff: DnsDiff | undefined;
  loading: boolean;
  nameserversSwitched: boolean;
  applying: boolean;
  /** 反映（更新系）の失敗は Dialog を開いたまま Error Card で見せる（ui-screens §4） */
  error: ApiClientError | null;
  onApply: () => void;
}

export function ApplyDnsDialog({
  open,
  onOpenChange,
  domain,
  diff,
  loading,
  nameserversSwitched,
  applying,
  error,
  onApply,
}: ApplyDnsDialogProps) {
  const total = diff === undefined ? 0 : diffTotal(diff);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>DNS に反映しますか？</DialogTitle>
          <DialogDescription variant="subtitle">
            {domain} · 反映先はアプリ内の DNS ゾーン
          </DialogDescription>
        </DialogHeader>

        {loading || diff === undefined ? (
          <div className="flex w-full flex-col gap-2">
            <Skeleton shape="line" />
            <Skeleton shape="block" />
            <Skeleton shape="block" />
          </div>
        ) : (
          <>
            <div className="flex w-full flex-wrap items-center gap-2">
              <Badge tone={countTone(diff.added.length, "neutral")}>
                {`追加 ${diff.added.length}`}
              </Badge>
              <Badge tone={countTone(diff.updated.length, "warn")}>
                {`変更 ${diff.updated.length}`}
              </Badge>
              <Badge tone={countTone(diff.removed.length, "warn")}>
                {`削除 ${diff.removed.length}`}
              </Badge>
              {diff.unchanged.length > 0 ? (
                <span className="min-w-0 text-caption text-muted">
                  {`変更なし ${diff.unchanged.length}（${diff.unchanged.join("・")}）`}
                </span>
              ) : null}
            </div>

            {total > 0 ? (
              <>
                <Divider weight="thin" />
                <div className="flex w-full flex-col">
                  {diff.added.map((host) => (
                    <DnsDiffRow
                      host={host.host}
                      key={`added-${host.id}`}
                      kind="added"
                      record={recordText(host)}
                    />
                  ))}
                  {diff.updated.map(({ host, previous }) => (
                    <DnsDiffRow
                      host={host.host}
                      key={`updated-${host.id}`}
                      kind="updated"
                      previous={recordText(previous)}
                      record={recordText(host)}
                    />
                  ))}
                  {diff.removed.map((record) => (
                    <DnsDiffRow
                      host={record.host}
                      key={`removed-${record.host}`}
                      kind="removed"
                      record={recordText(record)}
                    />
                  ))}
                </div>
              </>
            ) : null}

            <Divider weight="thin" />
            <NameserverBadge switched={nameserversSwitched} />
            <p className="w-full text-caption text-muted">{APPLY_NOTE}</p>
          </>
        )}

        {error === null ? null : <ErrorCard error={error} />}

        <DialogFooter>
          <DialogClose asChild>
            <Button disabled={applying} variant="subtle">
              キャンセル
            </Button>
          </DialogClose>
          <Button
            disabled={total === 0}
            leadingIcon={<Zap />}
            loading={applying}
            onClick={onApply}
            variant="primary"
          >
            {`${total} 件を反映する`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
