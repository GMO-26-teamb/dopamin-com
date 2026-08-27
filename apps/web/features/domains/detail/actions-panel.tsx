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
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, Divider } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import type { DomainDetail } from "@/lib/api/types";
import { isTransferLocked } from "./derive";
import {
  type DetailOperation,
  operationLabel,
  operationState,
} from "./operations";

/**
 * Figma: S-30 操作パネル（`83:2482`）/ S-32 の承認・拒否（`83:2709`）
 *
 * 可否は `packages/shared` の `isOperationAllowed` / `isRestorable`（AC-07-1）。
 * 不可のボタンは Disabled + ラベルに理由（「廃止 — 削除ロック中」）。
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
}: ActionsPanelProps) {
  const receivingTransfer = domain.displayStatus === "transfer_out_pending";

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
        </>
      ) : null}

      <OperationButton
        base="更新（期限延長）"
        domain={domain}
        icon={<RefreshCw />}
        onClick={onRenew}
        op="renew"
      />
      <OperationButton
        base="情報修正（NS・コンタクト）"
        domain={domain}
        icon={<Pencil />}
        onClick={onEditInfo}
        op="update"
      />
      <OperationButton
        base="移管OUT — AuthCode表示"
        domain={domain}
        icon={<ArrowLeftRight />}
        onClick={onAuthCode}
        op="transferOut"
      />
      <OperationButton
        base="廃止"
        domain={domain}
        icon={<Trash2 />}
        onClick={onDelete}
        op="delete"
      />
      <OperationButton
        base="復旧"
        domain={domain}
        icon={<RotateCcw />}
        onClick={onRestore}
        op="restore"
      />

      <Divider weight="thin" />
      <div className="flex w-full items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-body-sm text-muted">
          移管ロック
          <HelpTip
            content="ON のあいだは他社への移管を受け付けません。切り替えは「情報修正」から行います。レジストリ側の状態が優先されるため、できない操作はボタンに理由が出ます。"
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
  base: string;
  icon: ReactNode;
  onClick: () => void;
}

function OperationButton({
  domain,
  op,
  base,
  icon,
  onClick,
}: OperationButtonProps) {
  const state = operationState(domain, op);
  const label = operationLabel(base, state);
  const button = (
    <Button
      className="w-full"
      disabled={!state.allowed}
      leadingIcon={icon}
      onClick={onClick}
      variant={state.allowed ? "outline" : "subtle"}
    >
      {label}
    </Button>
  );

  if (state.allowed || state.blockedBy.length === 0) {
    return button;
  }

  // 理由（日本語）はボタンのラベルに入っている。根拠の EPP ステータス（英語名）は
  // 補足なので、Disabled なボタンでもホバーで読める `title` に載せる
  // （Disabled は pointer-events を持たないため、ラッパー側で拾う）。
  return (
    <span className="w-full" title={state.blockedBy.join(" / ")}>
      {button}
    </span>
  );
}
