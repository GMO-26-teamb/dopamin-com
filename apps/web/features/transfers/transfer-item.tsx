"use client";

/**
 * Figma: Transfer Item `78:475`（S-50 `85:5523`）
 *
 * 移管一覧の 1 件（FR-12）。Kind は `Transfer` の direction × status から決まる:
 * - `out-received`  受信した OUT 申請。拒否 / 承認 + 自動承認までの残り時間（warn 枠）
 * - `in-pending`    自分の IN 申請。状態を確認 / 取消
 * - `import-pending` 承認済み・取り込み待ち。再試行
 * - `history`       approved / rejected / cancelled。muted 枠 + 日付
 */

import { Check, RefreshCw } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Transfer } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { formatCountdown, useCountdown } from "./countdown";

export type TransferKind =
  | "out-received"
  | "in-pending"
  | "import-pending"
  | "history";

/** 一覧の 1 件がどの Kind で表示されるか（セクション分けにも使う）。 */
export function transferKind(transfer: Transfer): TransferKind {
  if (transfer.status === "pending") {
    return transfer.direction === "out" ? "out-received" : "in-pending";
  }
  if (transfer.status === "import_pending") {
    return "import-pending";
  }
  return "history";
}

const KIND_BORDER: Record<TransferKind, string> = {
  "out-received": "border-warn",
  "in-pending": "border-line",
  "import-pending": "border-line",
  history: "border-soft opacity-[var(--opacity-muted)]",
};

/** 履歴行の日付（`MM-DD`）。ローカルタイムで出す。 */
function formatMonthDay(iso: string): string {
  const date = new Date(iso);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}-${day}`;
}

const DIRECTION_LABEL: Record<Transfer["direction"], string> = {
  in: "IN",
  out: "OUT",
};

function historyStatusText(transfer: Transfer): string {
  const day = formatMonthDay(transfer.completedAt ?? transfer.requestedAt);
  switch (transfer.status) {
    case "approved":
      return transfer.direction === "out"
        ? `完了 — ${day} に移管 OUT`
        : `完了 — ${day} に移管 IN（取り込み済み）`;
    case "rejected":
      return `拒否 — ${day} に移管を拒否しました`;
    default:
      return `取消 — ${day} に申請を取り消しました`;
  }
}

function statusText(
  transfer: Transfer,
  kind: TransferKind,
  remainingMs: number | null,
): string {
  // 残り 0 は「もうサーバが自動承認した可能性がある」= 再照会が必要（ui-screens §4）
  const expired = remainingMs !== null && remainingMs <= 0;
  const countdown = remainingMs === null ? null : formatCountdown(remainingMs);
  switch (kind) {
    case "out-received":
      if (expired) {
        return "自動承認の期限を過ぎました — 状態を確認してください";
      }
      return countdown === null
        ? "移管申請を受信 — 承認または拒否してください"
        : `移管申請を受信 — 承認しないと ${countdown} 後に自動承認されます`;
    case "in-pending":
      if (expired) {
        return "申請中 — 自動承認の期限を過ぎました。状態を確認してください";
      }
      return countdown === null
        ? "申請中 — 相手レジストラの承認待ち"
        : `申請中 — 相手レジストラの承認待ち（自動承認まで ${countdown}）`;
    case "import-pending":
      return "承認済み — 取り込み待ち。「再試行」で取り込みを実行します";
    default:
      return historyStatusText(transfer);
  }
}

export interface TransferItemProps {
  transfer: Transfer;
  /** 申請 / 承認 / 拒否 / 取消 / 更新のいずれかが実行中。二重送信を避けるため行の操作をすべて止める */
  busy?: boolean;
  /**
   * S-53（更新エラー）。仕様で Disabled にするのは承認 / 拒否 / 取消 / 申請だけなので、
   * 「状態を確認」/「再試行」＝再照会の導線は残す（ui-screens S-53）。
   */
  updateFailed?: boolean;
  /** 「状態を確認」/「再試行」が実行中 */
  recheckPending?: boolean;
  onApprove?: (transfer: Transfer) => void;
  onReject?: (transfer: Transfer) => void;
  onCancel?: (transfer: Transfer) => void;
  onRecheck?: (transfer: Transfer) => void;
}

export function TransferItem({
  transfer,
  busy = false,
  updateFailed = false,
  recheckPending = false,
  onApprove,
  onReject,
  onCancel,
  onRecheck,
}: TransferItemProps) {
  const kind = transferKind(transfer);
  // 自動承認までの残り時間は out-received / in-pending だけが持つ
  const remainingMs = useCountdown(
    kind === "out-received" || kind === "in-pending" ? transfer.actByAt : null,
  );
  // 0 到達で操作を止め、再照会を促す（ui-screens §4）
  const expired = remainingMs !== null && remainingMs <= 0;
  const actionsDisabled = busy || updateFailed || expired;
  const recheckDisabled = busy || recheckPending;
  const isHistory = kind === "history";
  const linkable = isHistory && transfer.status === "approved";
  // 同じラベルのボタンが行ごとに並ぶので、読み上げ名はドメイン名で一意にする
  const name = transfer.domainName;

  return (
    <div
      className={cn(
        "flex w-full items-center gap-3 border-2 border-solid bg-panel px-3 py-2",
        KIND_BORDER[kind],
      )}
      data-kind={kind}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          {linkable ? (
            <Link
              className="min-w-0 truncate text-domain-card text-ink underline-offset-2 hover:underline"
              href={`/domains/${transfer.domainName}`}
            >
              {transfer.domainName}
            </Link>
          ) : (
            <span className="min-w-0 truncate text-domain-card text-ink">
              {transfer.domainName}
            </span>
          )}
          <Badge tone={isHistory ? "muted" : "neutral"}>
            {DIRECTION_LABEL[transfer.direction]}
          </Badge>
        </div>
        <p
          className={cn(
            "text-caption",
            kind === "out-received" ? "text-warn" : "text-muted",
          )}
        >
          {statusText(transfer, kind, remainingMs)}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {kind === "out-received" ? (
          <>
            {/* 期限切れは承認 / 拒否を止め、再照会だけを残す（ui-screens §4） */}
            {expired ? (
              <Button
                aria-label={`${name} の状態を確認`}
                disabled={recheckDisabled}
                leadingIcon={<RefreshCw />}
                loading={recheckPending}
                onClick={() => onRecheck?.(transfer)}
                size="sm"
                variant="subtle"
              >
                {recheckPending ? "確認中…" : "状態を確認"}
              </Button>
            ) : null}
            <Button
              aria-label={`${name} の移管を拒否`}
              disabled={actionsDisabled}
              onClick={() => onReject?.(transfer)}
              size="sm"
              variant="danger"
            >
              拒否
            </Button>
            <Button
              aria-label={`${name} の移管を承認`}
              disabled={actionsDisabled}
              leadingIcon={<Check />}
              onClick={() => onApprove?.(transfer)}
              size="sm"
              variant="solid"
            >
              承認
            </Button>
          </>
        ) : null}

        {kind === "in-pending" ? (
          <>
            <Button
              aria-label={`${name} の状態を確認`}
              disabled={recheckDisabled}
              leadingIcon={<RefreshCw />}
              loading={recheckPending}
              onClick={() => onRecheck?.(transfer)}
              size="sm"
              variant="subtle"
            >
              {recheckPending ? "確認中…" : "状態を確認"}
            </Button>
            <Button
              aria-label={`${name} の移管申請を取消`}
              disabled={actionsDisabled}
              onClick={() => onCancel?.(transfer)}
              size="sm"
              variant="outline"
            >
              取消
            </Button>
          </>
        ) : null}

        {kind === "import-pending" ? (
          <Button
            aria-label={`${name} の取り込みを再試行`}
            disabled={recheckDisabled}
            leadingIcon={<RefreshCw />}
            loading={recheckPending}
            onClick={() => onRecheck?.(transfer)}
            size="sm"
            variant="outline"
          >
            {recheckPending ? "取り込み中…" : "再試行"}
          </Button>
        ) : null}

        {isHistory ? (
          <span className="text-caption text-muted">
            {formatMonthDay(transfer.completedAt ?? transfer.requestedAt)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
