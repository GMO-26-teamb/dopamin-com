"use client";

/**
 * S-50〜S-53 + D-08 — 移管（FR-12）
 *
 * Figma: S-50 `85:5523` / S-51 `85:5760` / S-52 `85:5888` / S-53 `93:7717` / D-08 `85:6029`
 *
 * - S-50 一覧: Page Header（件数・「状態を更新」= Poll 消化）+ 移管 IN フォーム + 3 セクション
 * - S-51 0 件: フォーム + Empty State
 * - S-52 申請エラー（AC-12-2）: フォーム下に Error Card（再試行なし）
 * - S-53 更新エラー（FR-18）: Banner Warn + キャッシュ表示、承認 / 拒否 / 取消 / 申請は Disabled
 * - D-08 取消ダイアログ、D-06 同型の承認（再入力）/ 拒否ダイアログ
 *
 * 60 日ルールは UI で強制しない（要件 FR-12「移管可否は EPP ステータスのみで判定する」）。
 */

import { ArrowRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorCard } from "@/components/ui/error-card";
import {
  ApproveTransferDialog,
  RejectTransferDialog,
} from "@/features/transfers/approve-dialog";
import { CancelTransferDialog } from "@/features/transfers/cancel-dialog";
import { TransferForm } from "@/features/transfers/transfer-form";
import {
  groupTransfers,
  TransferSections,
  TransferSectionsSkeleton,
} from "@/features/transfers/transfer-sections";
import {
  type TransferAction,
  useRefreshTransfers,
  useRequestTransfer,
  useTransferAction,
  useTransfers,
} from "@/lib/api/hooks";
import type { Transfer } from "@/lib/api/types";
import { toErrorCopy } from "@/lib/error-messages";

interface PageBanner {
  title: string;
  body: string;
  href?: string;
}

const ACTION_BANNER: Record<
  TransferAction,
  (transfer: Transfer) => PageBanner
> = {
  approve: (transfer) => ({
    title: "移管を承認しました",
    body: `${transfer.domainName} は相手レジストラに移りました。保有ドメイン一覧からは外れます。`,
    href: `/domains/${transfer.domainName}`,
  }),
  reject: (transfer) => ({
    title: "移管申請を拒否しました",
    body: `${transfer.domainName} は引き続き保有しています。`,
    href: `/domains/${transfer.domainName}`,
  }),
  cancel: (transfer) => ({
    title: "移管申請を取り消しました",
    body: `${transfer.domainName} の申請を取り消しました。再申請には AuthCode の再発行が必要な場合があります。`,
  }),
};

export default function TransfersPage() {
  return (
    <Suspense fallback={<TransfersFallback />}>
      <TransfersView />
    </Suspense>
  );
}

/** `useSearchParams()` を使うので Suspense 境界の外側は静的に出せる形にしておく。 */
function TransfersFallback() {
  return (
    <>
      <PageHeader title="移管" />
      <TransferSectionsSkeleton />
    </>
  );
}

function TransfersView() {
  const searchParams = useSearchParams();
  // ダッシュボード / 詳細からの `?domain=<name>` を申請フォームに引き継ぐ
  const prefillDomain = searchParams.get("domain") ?? "";

  const transfers = useTransfers();
  const refresh = useRefreshTransfers();
  const request = useRequestTransfer();
  const action = useTransferAction();

  const [banner, setBanner] = useState<PageBanner | null>(null);
  const [dialog, setDialog] = useState<{
    action: TransferAction;
    transfer: Transfer;
  } | null>(null);
  const [recheckingId, setRecheckingId] = useState<string | null>(null);
  // 承認 / 拒否 / 取消が失敗したときに、同じ操作をそのまま再試行できるようにする
  const [lastAttempt, setLastAttempt] = useState<{
    action: TransferAction;
    transfer: Transfer;
  } | null>(null);

  // S-53: 一覧の再取得に失敗しても、キャッシュがあるなら表示は続けて Banner Warn を出す
  const updateError =
    refresh.error ?? (transfers.data === undefined ? null : transfers.error);
  const busy = refresh.isPending || request.isPending || action.isPending;
  const actionsDisabled = busy || updateError !== null;

  const runRefresh = (rowId: string | null) => {
    const before = transfers.data ?? [];
    setRecheckingId(rowId);
    setBanner(null);
    refresh.mutate(undefined, {
      onSuccess: (next) => {
        // 取り込み完了（IN が approved になった）を検知したら Banner Ok（S-30 へ）
        const imported = next.find(
          (candidate) =>
            candidate.direction === "in" &&
            candidate.status === "approved" &&
            before.some(
              (previous) =>
                previous.id === candidate.id && previous.status !== "approved",
            ),
        );
        if (imported !== undefined) {
          setBanner({
            title: "取り込みました",
            body: `${imported.domainName} を保有ドメインに追加しました。`,
            href: `/domains/${imported.domainName}`,
          });
        }
      },
      onSettled: () => setRecheckingId(null),
    });
  };

  const submitRequest = (input: { name: string; authCode: string }) => {
    setBanner(null);
    request.mutate(input, {
      onSuccess: (created) => {
        setBanner({
          title: "移管を申請しました",
          body: `${created.domainName} を「申請中（移管 IN）」に追加しました。相手レジストラの承認（または 20 分後の自動承認）で取り込まれます。`,
        });
      },
    });
  };

  const runAction = (transfer: Transfer, kind: TransferAction) => {
    setLastAttempt({ action: kind, transfer });
    setBanner(null);
    action.mutate(
      { id: transfer.id, action: kind },
      {
        onSuccess: (updated) => {
          setDialog(null);
          setBanner(ACTION_BANNER[kind](updated));
        },
        // 失敗は Error Card（FR-18）で出すのでダイアログは閉じる
        onError: () => setDialog(null),
      },
    );
  };

  const confirmDialog = (transfer: Transfer) => {
    if (dialog !== null) {
      runAction(transfer, dialog.action);
    }
  };

  const updateErrorCopy =
    updateError === null ? null : toErrorCopy(updateError);
  const groups = groupTransfers(transfers.data ?? []);
  const meta =
    transfers.data === undefined
      ? undefined
      : `受信 ${groups.received.length} · 申請中 ${groups.pending.length} · 履歴 ${groups.history.length} · ${
          updateError === null ? "Poll 消化済み" : "最終更新に失敗"
        }`;

  return (
    <>
      <PageHeader
        action={
          <Button
            disabled={refresh.isPending}
            leadingIcon={<RefreshCw />}
            loading={refresh.isPending}
            onClick={() => runRefresh(null)}
            size="sm"
            variant="outline"
          >
            {refresh.isPending ? "更新中…" : "状態を更新"}
          </Button>
        }
        meta={meta}
        title="移管"
      />

      {banner === null ? null : (
        <Banner
          action={
            banner.href === undefined ? undefined : (
              <Button
                asChild
                size="sm"
                trailingIcon={<ArrowRight />}
                variant="subtle"
              >
                <Link href={banner.href}>ドメインを見る</Link>
              </Button>
            )
          }
          body={banner.body}
          onClose={() => setBanner(null)}
          title={banner.title}
          tone="ok"
        />
      )}

      {updateErrorCopy === null ? null : (
        <Banner
          action={
            <Button
              disabled={refresh.isPending}
              onClick={() => runRefresh(null)}
              size="sm"
              variant="outline"
            >
              再試行
            </Button>
          }
          body={`${updateErrorCopy.body} 表示は最後に取得した内容です。`}
          title={updateErrorCopy.title}
          tone="warn"
        />
      )}

      {action.error === null ? null : (
        <ErrorCard
          error={action.error}
          onRetry={
            lastAttempt === null
              ? undefined
              : () => runAction(lastAttempt.transfer, lastAttempt.action)
          }
          showLogsLink
        />
      )}

      <TransferForm
        defaultDomain={prefillDomain}
        disabled={actionsDisabled}
        error={request.error}
        onSubmit={submitRequest}
        submitting={request.isPending}
      />

      {transfers.isPending ? <TransferSectionsSkeleton /> : null}

      {transfers.data === undefined && transfers.error !== null ? (
        <ErrorCard
          error={transfers.error}
          onRetry={() => void transfers.refetch()}
          showLogsLink
        />
      ) : null}

      {transfers.data !== undefined && transfers.data.length === 0 ? (
        <EmptyState
          body="他社で取得したドメインは、上のフォームにドメイン名と AuthCode を入れて持ち込めます。相手レジストラから届いた移管申請もここに表示されます。"
          secondary={
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard">保有ドメインを見る</Link>
            </Button>
          }
          title="移管はまだありません"
        />
      ) : null}

      {transfers.data !== undefined && transfers.data.length > 0 ? (
        <TransferSections
          disabled={actionsDisabled}
          onApprove={(transfer) => setDialog({ action: "approve", transfer })}
          onCancel={(transfer) => setDialog({ action: "cancel", transfer })}
          onRecheck={(transfer) => runRefresh(transfer.id)}
          onReject={(transfer) => setDialog({ action: "reject", transfer })}
          recheckingId={recheckingId}
          transfers={transfers.data}
        />
      ) : null}

      <ApproveTransferDialog
        busy={action.isPending}
        onConfirm={confirmDialog}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
          }
        }}
        open={dialog?.action === "approve"}
        transfer={dialog?.action === "approve" ? dialog.transfer : null}
      />
      <RejectTransferDialog
        busy={action.isPending}
        onConfirm={confirmDialog}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
          }
        }}
        open={dialog?.action === "reject"}
        transfer={dialog?.action === "reject" ? dialog.transfer : null}
      />
      <CancelTransferDialog
        busy={action.isPending}
        onConfirm={confirmDialog}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
          }
        }}
        open={dialog?.action === "cancel"}
        transfer={dialog?.action === "cancel" ? dialog.transfer : null}
      />
    </>
  );
}
