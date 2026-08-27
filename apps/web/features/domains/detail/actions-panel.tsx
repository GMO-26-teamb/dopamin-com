"use client";

import {
  ArrowLeftRight,
  Check,
  Pencil,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { type ReactNode, useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, Divider } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import type { DomainDetail } from "@/lib/api/types";
import { isTransferLocked } from "./derive";
import { type DetailOperation, operationState } from "./operations";

/**
 * Figma: S-30 操作パネル（`83:2482`）/ S-32 の承認・拒否（`83:2709`）
 *
 * 可否は `packages/shared` の `isOperationAllowed` / `isRestorable`（AC-07-1）。
 * 移管申請を受信中（S-32）は先頭に「拒否 / 承認」+ 自動承認までの残り時間を出し、他は Disabled。
 */
export interface ActionsPanelProps {
  domain: DomainDetail;
  onRenew: () => void;
  onEditInfo: () => void;
  onAuthCode: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onApproveTransfer: () => void;
  onRejectTransfer: () => void;
  /** S-32 のカウントダウン（`mm:ss`）。 */
  countdownLabel: string;
  /** カウントダウンが 0 に到達した（ボタンを止めて再照会中）。 */
  countdownExpired: boolean;
  /** 承認 / 拒否の対象となる移管が特定できているか。 */
  transferActionable: boolean;
  /** 対象を特定できていないときの再取得（#212）。 */
  onRetryTransfers: () => void;
  /** 再取得の実行中。 */
  retryingTransfers: boolean;
}

export function ActionsPanel({
  domain,
  onRenew,
  onEditInfo,
  onAuthCode,
  onDelete,
  onRestore,
  onApproveTransfer,
  onRejectTransfer,
  countdownLabel,
  countdownExpired,
  transferActionable,
  onRetryTransfers,
  retryingTransfers,
}: ActionsPanelProps) {
  const receivingTransfer = domain.displayStatus === "transfer_out_pending";
  // ロックで止まっている操作は Disabled + 理由を残し（AC-07-1）、その状態では
  // 概念的に存在しない操作（Active なドメインの「復旧」など）は出さない。
  const showRestore = domain.displayStatus === "rgp";

  return (
    <Card kicker="操作">
      {receivingTransfer ? (
        <>
          <div className="flex w-full items-center gap-2">
            <Button
              className="flex-1 justify-center"
              disabled={countdownExpired || !transferActionable}
              leadingIcon={<X />}
              onClick={onRejectTransfer}
              variant="danger"
            >
              拒否
            </Button>
            <Button
              className="flex-1 justify-center"
              disabled={countdownExpired || !transferActionable}
              leadingIcon={<Check />}
              onClick={onApproveTransfer}
              variant="solid"
            >
              承認
            </Button>
          </div>
          <p className="w-full text-label-sm text-warn">
            {countdownExpired
              ? "状態を確認中…"
              : `自動承認まで ${countdownLabel}`}
          </p>
          {transferActionable ? null : (
            // 詳細だけでは承認 / 拒否に必要な申請が特定できない（一覧の取得に失敗した）。
            // 押せない理由と、その場で解決する手段を並べる（#212）
            <div className="flex w-full flex-col items-start gap-1.5">
              <p className="w-full text-caption text-muted">
                申請の内容をまだ取得できていません。
              </p>
              <Button
                leadingIcon={<RefreshCw />}
                loading={retryingTransfers}
                onClick={onRetryTransfers}
                size="sm"
                variant="outline"
              >
                {retryingTransfers ? "取得中…" : "申請を取得"}
              </Button>
            </div>
          )}
        </>
      ) : null}

      <OperationButton
        domain={domain}
        icon={<RefreshCw />}
        label="有効期限を延長"
        onClick={onRenew}
        op="renew"
      />
      <OperationButton
        domain={domain}
        icon={<Pencil />}
        label="情報修正"
        onClick={onEditInfo}
        op="update"
      />
      <OperationButton
        domain={domain}
        icon={<ArrowLeftRight />}
        label="他社へ移管する"
        onClick={onAuthCode}
        op="transferOut"
      />
      <OperationButton
        domain={domain}
        icon={<Trash2 />}
        label="廃止"
        onClick={onDelete}
        op="delete"
      />
      {showRestore ? (
        <OperationButton
          domain={domain}
          icon={<RotateCcw />}
          label="復旧"
          onClick={onRestore}
          op="restore"
        />
      ) : null}

      <Divider weight="thin" />
      <div className="flex w-full items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-body-sm text-muted">
          移管ロック
          <HelpTip
            content="ON のあいだは他社への移管を受け付けません（切り替えは「情報修正」から）。"
            label="移管ロックとは"
          />
        </span>
        <Badge tone="neutral" variant="solid">
          {isTransferLocked(domain.statuses) ? "ON" : "OFF"}
        </Badge>
      </div>
    </Card>
  );
}

interface OperationButtonProps {
  domain: DomainDetail;
  op: DetailOperation;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}

function OperationButton({
  domain,
  op,
  label,
  icon,
  onClick,
}: OperationButtonProps) {
  const state = operationState(domain, op);
  const reasonId = useId();

  return (
    <div className="flex w-full flex-col items-start gap-0.5">
      <Button
        aria-describedby={state.allowed ? undefined : reasonId}
        className="w-full"
        disabled={!state.allowed}
        leadingIcon={icon}
        onClick={onClick}
        variant={state.allowed ? "outline" : "subtle"}
      >
        {label}
      </Button>
      {state.allowed || state.reason === null ? null : (
        // 根拠の EPP ステータス（英語名）は補足なので `title` に載せる。
        // Disabled なボタン自体はホバーを拾わないため、理由の行に付ける
        <p
          className="w-full text-caption text-muted"
          id={reasonId}
          {...(state.blockedBy.length > 0
            ? { title: state.blockedBy.join(" / ") }
            : {})}
        >
          {state.reason}
        </p>
      )}
    </div>
  );
}
