"use client";

import { DISPLAY_STATUS_LABEL, ERROR_STATUS } from "@dopamin/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  SuccessDialog,
} from "@/components/ui/dialog";
import { ErrorCard } from "@/components/ui/error-card";
import {
  ApiClientError,
  type ClientErrorCode,
  toApiClientError,
} from "@/lib/api/errors";
import { useQueryKeys } from "@/lib/api/hooks";
import { useServices } from "@/lib/api/provider";
import type { DomainDetail } from "@/lib/api/types";
import { toErrorCopy } from "@/lib/error-messages";

/**
 * Figma: S-26 `81:1531` / S-27 `81:1588` / S-28 `81:1663`
 * 登録の結果ダイアログ。成功（Dialog / Success）・409 CONFLICT・create タイムアウト（AC-06-2）。
 */

const HTTP_STATUS: Partial<Record<ClientErrorCode, number>> = ERROR_STATUS;

// ---- S-26 登録成功 ----

export interface RegisterSuccessDialogProps {
  domain: DomainDetail | null;
  onOpenChange: (open: boolean) => void;
  onGoToSubdomains: (name: string) => void;
  onGoToDetail: (name: string) => void;
}

export function RegisterSuccessDialog({
  domain,
  onOpenChange,
  onGoToSubdomains,
  onGoToDetail,
}: RegisterSuccessDialogProps) {
  if (domain === null) {
    return null;
  }

  const status = DISPLAY_STATUS_LABEL[domain.displayStatus];
  const expires =
    domain.expiresAt === null ? "—" : domain.expiresAt.slice(0, 10);

  return (
    <SuccessDialog
      body={`${status} になりました。有効期限 ${expires}・ネームサーバーは既定値。次はサブドメインの構成を決めましょう。`}
      domain={domain.name}
      onOpenChange={onOpenChange}
      onPrimary={() => onGoToSubdomains(domain.name)}
      onSecondary={() => onGoToDetail(domain.name)}
      open
      primaryLabel="サブドメイン設計に進む"
      secondaryLabel="詳細を見る"
      title="取得できました"
    />
  );
}

// ---- S-27 取得済み（CONFLICT 409） ----

export interface RegisterConflictDialogProps {
  conflict: { name: string; alternatives: readonly string[] } | null;
  onOpenChange: (open: boolean) => void;
  onShowAlternatives: (names: string[]) => void;
}

export function RegisterConflictDialog({
  conflict,
  onOpenChange,
  onShowAlternatives,
}: RegisterConflictDialogProps) {
  if (conflict === null) {
    return null;
  }

  const alternatives = conflict.alternatives.slice(0, 3);

  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{conflict.name} は取得できませんでした</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          直前の再確認で取得済みになっていました（CONFLICT /{" "}
          {ERROR_STATUS.CONFLICT}）。別の TLD
          や綴り違いの代替候補を確認してください。
        </DialogDescription>
        {alternatives.length === 0 ? null : (
          <p className="w-full text-body-sm text-ink">
            {alternatives.join("・")}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="subtle">閉じる</Button>
          </DialogClose>
          <Button
            onClick={() => onShowAlternatives([...alternatives])}
            trailingIcon={<ArrowRight />}
            variant="solid"
          >
            代替候補を見る
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- S-28 create タイムアウト（AC-06-2） ----

/** 照合の結果。再送はせず `info` → `check` の順に確認する（ui-screens S-28）。 */
export type ReconcileOutcome =
  | { kind: "registered"; domain: DomainDetail }
  | { kind: "available" }
  | { kind: "taken"; alternatives: string[] };

export interface RegisterTimeoutDialogProps {
  timeout: { name: string; error: ApiClientError } | null;
  onOpenChange: (open: boolean) => void;
  onOutcome: (outcome: ReconcileOutcome) => void;
}

export function RegisterTimeoutDialog({
  timeout,
  onOpenChange,
  onOutcome,
}: RegisterTimeoutDialogProps) {
  const services = useServices();
  const queryClient = useQueryClient();
  const keys = useQueryKeys();

  const reconcile = useMutation<ReconcileOutcome, ApiClientError, string>({
    mutationFn: async (name) => {
      try {
        const domain = await services.domains.get(name);
        return { kind: "registered", domain };
      } catch (caught) {
        const error = toApiClientError(caught);
        // 「まだ無い」以外は照合できていないので、そのまま S-28 に留まる
        if (error.code !== "NOT_FOUND") {
          throw error;
        }
      }
      const [result] = await services.domains.check({ names: [name] });
      if (result === undefined || result.availability === "error") {
        throw new ApiClientError({
          code: "REGISTRY_UNAVAILABLE",
          message: "登録の結果を確認できませんでした。",
          retryable: true,
        });
      }
      return result.availability === "available"
        ? { kind: "available" }
        : { kind: "taken", alternatives: result.alternatives };
    },
    onSuccess: (outcome) => {
      if (outcome.kind === "registered") {
        queryClient.setQueryData(
          keys.domain(outcome.domain.name),
          outcome.domain,
        );
        void queryClient.invalidateQueries({ queryKey: keys.domains() });
      }
      onOutcome(outcome);
    },
  });

  if (timeout === null) {
    return null;
  }

  const copy = toErrorCopy(timeout.error);
  const status = HTTP_STATUS[timeout.error.code];
  const meta = [
    timeout.error.code,
    status === undefined ? null : `${status}`,
    timeout.error.requestId ?? null,
  ].filter((part): part is string => part !== null);

  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          登録リクエストがタイムアウトしました。二重登録を避けるため再送はせず、info
          で結果を確認します。{copy.body}
        </DialogDescription>
        <p className="w-full text-code text-muted">{meta.join("・")}</p>
        {reconcile.error === null ? null : (
          <ErrorCard
            error={reconcile.error}
            onRetry={() => reconcile.mutate(timeout.name)}
            showLogsLink
          />
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button disabled={reconcile.isPending} variant="subtle">
              閉じる
            </Button>
          </DialogClose>
          <Button
            leadingIcon={<RefreshCw />}
            loading={reconcile.isPending}
            onClick={() => reconcile.mutate(timeout.name)}
            variant="solid"
          >
            {reconcile.error === null ? "結果を確認" : "もう一度確認"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
