"use client";

import { formatJpy } from "@dopamin/shared";
import { LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorCard } from "@/components/ui/error-card";
import type { ApiClientError } from "@/lib/api/errors";
import {
  useAuthCode,
  useDeleteDomain,
  useDomain,
  useRenewDomain,
  useRestoreDomain,
  useTransferAction,
  useTransfers,
  useUpdateDomain,
} from "@/lib/api/hooks";
import type { DomainUpdateInput } from "@/lib/api/services";
import { useCountdown } from "@/lib/use-countdown";
import { AuthCodeDialog } from "../dialogs/auth-code-dialog";
import { DeleteDialog } from "../dialogs/delete-dialog";
import { NsEditDialog } from "../dialogs/ns-edit-dialog";
import { RenewDialog } from "../dialogs/renew-dialog";
import { RestoreDialog } from "../dialogs/restore-dialog";
import { TransferDecisionDialog } from "../dialogs/transfer-decision-dialog";
import { ActionsPanel } from "./actions-panel";
import { ContactCard } from "./contact-card";
import { DetailHeader } from "./detail-header";
import { DetailSkeleton } from "./detail-skeleton";
import { InfoCard } from "./info-card";
import { NameserverCard } from "./nameserver-card";
import { StateBanner } from "./state-banner";
import { SubdomainCard } from "./subdomain-card";

/**
 * S-30〜S-39 + D-01〜D-07（ui-screens §2.5、fe-ui 設計 §2 / §6）。
 *
 * `useDomain(name)` の `isPending / error / data` から `loading | error | ready` に分岐する。
 * 状態表示は `deriveDisplayStatus` の結果（`DomainDetail.displayStatus`）をそのまま使い、
 * UI 側で EPP ステータスを再解釈しない（ui-screens §6）。
 */
type DialogKind =
  | "none"
  | "renew"
  | "ns-edit"
  | "delete"
  | "restore"
  | "auth-code"
  | "transfer-approve"
  | "transfer-reject";

/**
 * 更新系の操作を起こしたダイアログ（D-07 の Error Card から「再試行」で開き直す先）。
 * AuthCode（D-05）はダイアログ内で完結するのでここには含めない。
 */
type OperationDialogKind = Exclude<DialogKind, "none" | "auth-code">;

export interface DomainDetailPageProps {
  name: string;
}

export function DomainDetailPage({ name }: DomainDetailPageProps) {
  const router = useRouter();
  const domainQuery = useDomain(name);
  const transfersQuery = useTransfers();

  const [dialog, setDialog] = useState<DialogKind>("none");
  const [success, setSuccess] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<ApiClientError | null>(
    null,
  );
  const [authCode, setAuthCode] = useState<string | null>(null);
  // D-07: 直前に失敗した操作。「再試行」で同じダイアログを開き直す
  const [lastOperation, setLastOperation] =
    useState<OperationDialogKind | null>(null);

  const renew = useRenewDomain(name);
  const update = useUpdateDomain(name);
  const remove = useDeleteDomain(name);
  const restore = useRestoreDomain(name);
  const issueAuthCode = useAuthCode(name);
  const transferAction = useTransferAction();

  const domain = domainQuery.data;
  const now = Date.now();

  // S-32 / D-06: 承認 / 拒否の対象。詳細の `transfer` には id が無いので一覧から引く
  const pendingTransfer =
    transfersQuery.data?.find(
      (transfer) =>
        transfer.domainName === name &&
        transfer.direction === "out" &&
        transfer.status === "pending",
    ) ?? null;
  const actByAt = domain?.transfer?.actByAt ?? pendingTransfer?.actByAt ?? null;
  const receivingTransfer = domain?.displayStatus === "transfer_out_pending";
  const countdown = useCountdown(receivingTransfer ? actByAt : null);

  // カウントダウンが 0 になったら操作を止めて再照会する（ui-screens §4 / S-32 → S-34）
  const refetchDomain = domainQuery.refetch;
  const refetchTransfers = transfersQuery.refetch;
  const recheckedRef = useRef(false);
  useEffect(() => {
    if (!receivingTransfer || !countdown.expired) {
      recheckedRef.current = false;
      return;
    }
    if (recheckedRef.current) {
      return;
    }
    recheckedRef.current = true;
    void refetchDomain();
    void refetchTransfers();
  }, [receivingTransfer, countdown.expired, refetchDomain, refetchTransfers]);

  const closeDialog = useCallback(() => setDialog("none"), []);
  const openDialog = useCallback((kind: DialogKind) => {
    setOperationError(null);
    setSuccess(null);
    setDialog(kind);
  }, []);

  /**
   * 更新系の共通後処理。成功なら Banner Ok、失敗なら Error Card（D-07）。
   * 失敗した操作を覚えておき、「再試行」で同じダイアログを開き直せるようにする。
   */
  const settle = useCallback(
    (kind: OperationDialogKind, message: string) => ({
      onSuccess: () => {
        setSuccess(message);
        setOperationError(null);
        setLastOperation(null);
        setDialog("none");
      },
      onError: (error: ApiClientError) => {
        setOperationError(error);
        setLastOperation(kind);
        setSuccess(null);
        setDialog("none");
      },
    }),
    [],
  );

  const handleIssueAuthCode = useCallback(() => {
    setAuthCode(null);
    issueAuthCode.mutate(undefined, {
      onSuccess: (result) => setAuthCode(result.authCode),
    });
  }, [issueAuthCode]);

  // ---- loading（S-35） ----
  if (domainQuery.isPending) {
    return <DetailSkeleton />;
  }

  // ---- error ----
  if (domainQuery.error !== null) {
    const error = domainQuery.error;
    // 所有権なし / 未登録は S-80 と同じ案内を出す（ui-screens §1）
    if (error.code === "NOT_FOUND" || error.code === "FORBIDDEN") {
      return (
        <EmptyState
          body="URL が間違っているか、ドメインが移管済み / 削除済みの可能性があります。"
          className="max-w-120 self-center"
          primary={
            <Button asChild leadingIcon={<LayoutDashboard />} variant="primary">
              <Link href="/dashboard">ダッシュボードへ</Link>
            </Button>
          }
          title="ページが見つかりません"
        />
      );
    }
    return (
      <ErrorCard
        error={error}
        onRetry={() => void domainQuery.refetch()}
        showLogsLink
      />
    );
  }

  if (domain === undefined) {
    // isPending / error のどちらでもないのに data が無いことは無いが、型を絞るため
    return <DetailSkeleton />;
  }

  // ---- ready（S-30〜S-39） ----
  // S-34（移管済み）/ S-36（削除待ち）は操作パネルを出さない
  const showActions =
    domain.displayStatus !== "transferred_out" &&
    domain.displayStatus !== "pending_delete";
  const editable = showActions && !domain.stale;
  const busy =
    renew.isPending ||
    update.isPending ||
    remove.isPending ||
    restore.isPending ||
    transferAction.isPending;
  // 再試行できないコード（OPERATION_NOT_ALLOWED / REGISTRY_REJECTED など）は「閉じる」だけ出す
  const retryOperation =
    lastOperation === null || operationError?.retryable !== true
      ? null
      : () => openDialog(lastOperation);

  return (
    <>
      {operationError === null ? null : (
        <div className="flex w-full flex-col items-start gap-2">
          {/* D-07: 更新系の失敗。retryable なら同じダイアログを開き直す */}
          <ErrorCard
            error={operationError}
            showLogsLink
            {...(retryOperation === null ? {} : { onRetry: retryOperation })}
          />
          {retryOperation === null ? (
            <Button
              onClick={() => setOperationError(null)}
              size="sm"
              variant="subtle"
            >
              閉じる
            </Button>
          ) : null}
        </div>
      )}
      <StateBanner
        countdownLabel={countdown.label}
        domain={domain}
        now={now}
        onDismissSuccess={() => setSuccess(null)}
        onEditInfo={() => openDialog("ns-edit")}
        success={success}
      />
      <DetailHeader
        domain={domain}
        now={now}
        onResync={() => void domainQuery.refetch()}
        resyncing={domainQuery.isFetching}
      />

      <div className="flex w-full flex-col items-start gap-4 lg:flex-row">
        <div className="flex w-full min-w-0 flex-1 flex-col gap-3">
          <InfoCard domain={domain} now={now} />
          <NameserverCard
            domain={domain}
            editable={editable}
            onEdit={() => openDialog("ns-edit")}
          />
          <div className="flex w-full flex-col items-start gap-3 md:flex-row">
            <div className="w-full min-w-0 flex-1">
              <ContactCard domain={domain} />
            </div>
            <div className="min-w-0 flex-1">
              <SubdomainCard domain={domain} readOnly={!showActions} />
            </div>
          </div>
        </div>
        {showActions ? (
          <div className="w-full shrink-0 lg:w-80">
            <ActionsPanel
              countdownExpired={countdown.expired}
              countdownLabel={countdown.label}
              domain={domain}
              onApproveTransfer={() => openDialog("transfer-approve")}
              onAuthCode={() => openDialog("auth-code")}
              onDelete={() => openDialog("delete")}
              onEditInfo={() => openDialog("ns-edit")}
              onRejectTransfer={() => openDialog("transfer-reject")}
              onRenew={() => openDialog("renew")}
              onRestore={() => openDialog("restore")}
              transferActionable={pendingTransfer !== null}
            />
          </div>
        ) : null}
      </div>

      {/* D-01 更新 */}
      <RenewDialog
        busy={renew.isPending}
        domain={domain}
        now={now}
        onOpenChange={(open) => {
          if (!open) {
            closeDialog();
          }
        }}
        onSubmit={(period, receipt) =>
          renew.mutate(
            { period },
            settle(
              "renew",
              `${domain.name} の有効期限を延長しました（お支払い ${formatJpy(receipt.amount)}・受付 ${receipt.id}・モック）`,
            ),
          )
        }
        open={dialog === "renew"}
      />

      {/* D-02 情報修正（NS・コンタクト） */}
      <NsEditDialog
        busy={update.isPending}
        domain={domain}
        onOpenChange={(open) => {
          if (!open) {
            closeDialog();
          }
        }}
        onSubmit={(input: DomainUpdateInput) =>
          update.mutate(
            input,
            settle("ns-edit", `${domain.name} の情報を更新しました`),
          )
        }
        open={dialog === "ns-edit"}
      />

      {/* D-03 廃止 */}
      <DeleteDialog
        busy={remove.isPending}
        domain={domain}
        now={now}
        onOpenChange={(open) => {
          if (!open) {
            closeDialog();
          }
        }}
        onSubmit={() =>
          remove.mutate(undefined, {
            onSuccess: (result) => {
              setDialog("none");
              setOperationError(null);
              setLastOperation(null);
              if (result.outcome === "deleted") {
                // AGP 即時削除は詳細 URL が消えるのでダッシュボードへ戻す（FR-10 / 要確認 #5）
                router.push(
                  `/dashboard?deleted=${encodeURIComponent(domain.name)}`,
                );
                return;
              }
              setSuccess(
                `${domain.name} を廃止しました。復旧猶予（RGP）に入りました`,
              );
            },
            onError: (error) => {
              setOperationError(error);
              setLastOperation("delete");
              setDialog("none");
            },
          })
        }
        open={dialog === "delete"}
      />

      {/* D-04 復旧 */}
      <RestoreDialog
        busy={restore.isPending}
        domain={domain}
        now={now}
        onOpenChange={(open) => {
          if (!open) {
            closeDialog();
          }
        }}
        onSubmit={() =>
          restore.mutate(
            undefined,
            settle(
              "restore",
              `${domain.name} を復旧しました。Active に戻りました`,
            ),
          )
        }
        open={dialog === "restore"}
      />

      {/* D-05 AuthCode 発行 */}
      <AuthCodeDialog
        authCode={authCode}
        busy={issueAuthCode.isPending}
        domainName={domain.name}
        error={issueAuthCode.error}
        onIssue={handleIssueAuthCode}
        onOpenChange={(open) => {
          if (!open) {
            closeDialog();
          }
        }}
        open={dialog === "auth-code"}
      />

      {/* D-06 移管の承認 / 拒否 */}
      <TransferDecisionDialog
        busy={transferAction.isPending}
        countdownLabel={countdown.label}
        decision={dialog === "transfer-reject" ? "reject" : "approve"}
        domainName={domain.name}
        onOpenChange={(open) => {
          if (!open) {
            closeDialog();
          }
        }}
        onSubmit={() => {
          if (pendingTransfer === null) {
            return;
          }
          const action = dialog === "transfer-reject" ? "reject" : "approve";
          transferAction.mutate(
            { id: pendingTransfer.id, action },
            settle(
              action === "approve" ? "transfer-approve" : "transfer-reject",
              action === "approve"
                ? `${domain.name} の移管を承認しました`
                : `${domain.name} の移管を拒否しました`,
            ),
          );
        }}
        open={dialog === "transfer-approve" || dialog === "transfer-reject"}
      />

      {busy ? (
        <span aria-live="polite" className="sr-only">
          実行中…
        </span>
      ) : null}
    </>
  );
}
