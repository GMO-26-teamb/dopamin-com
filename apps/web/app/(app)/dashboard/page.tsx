"use client";

import type { RegistryId } from "@dopamin/shared";
import { Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorCard } from "@/components/ui/error-card";
import { HelpTip } from "@/components/ui/help-tip";
import { DomainGridSkeleton } from "@/features/domains/domain-card-skeleton";
import { DomainGrid, visibleDomains } from "@/features/domains/domain-grid";
import { formatRelativeTime } from "@/features/domains/format";
import { REGISTRY_LABEL } from "@/features/domains/registry-label";
import type { ApiClientError } from "@/lib/api/errors";
import { useDomains, useSyncDomains } from "@/lib/api/hooks";
import { useQueryScope } from "@/lib/api/provider";
import type { DomainSummary } from "@/lib/api/types";

/**
 * S-10 保有ドメイン一覧 / S-11 0 件 / S-12 読み込み / S-13 同期エラー（FR-02・AC-18-1）。
 *
 * `GET /domains`（DB キャッシュ）を先に描画し、`POST /domains/sync` は背後で 1 回だけ走らせる
 * （ui-screens S-12）。同期に失敗したら Banner Warn を出し、キャッシュ表示を続ける。
 */

/** S-13: 落ちているレジストリ名から見出しを作る。特定できなければ総称にする。 */
function syncErrorTitle(
  error: ApiClientError,
  domains: readonly DomainSummary[],
): string {
  // エラーがレジストリを名指ししていればそれが正。無いときだけ Stale なカードから推定する
  const registries = new Set<RegistryId>();
  if (error.registry === undefined) {
    for (const domain of domains) {
      if (domain.stale) {
        registries.add(domain.registry);
      }
    }
  } else {
    registries.add(error.registry);
  }

  const names = [...registries];
  const only = names[0];
  const subject =
    names.length >= 2
      ? "両レジストリ"
      : only === undefined
        ? "レジストリ"
        : REGISTRY_LABEL[only];
  // 英字のレジストリ名のときだけ和文との間に半角スペースを入れる
  const separator = /[A-Za-z0-9]$/.test(subject) ? " " : "";
  return `${subject}${separator}が応答しません — 一覧はキャッシュを表示しています`;
}

function syncErrorBody(lastSyncedAt: string | null, now: Date): string {
  const prefix =
    lastSyncedAt === null
      ? ""
      : `最終同期 ${formatRelativeTime(lastSyncedAt, now)}。`;
  return `${prefix}参照系は自動で 2 回再試行しました。しばらくして「最新化」を押してください。`;
}

/** 自動同期をスキップする鮮度のしきい値（ms）。「最新化」ボタンの手動実行はこのガードの対象外。 */
const AUTO_SYNC_FRESHNESS_MS = 60_000;

/** 一覧の中でもっとも新しい `syncedAt`。1 件もなければ null。 */
function latestSyncedAt(domains: readonly DomainSummary[]): string | null {
  return domains.reduce<string | null>(
    (latest, domain) =>
      latest === null || domain.syncedAt > latest ? domain.syncedAt : latest,
    null,
  );
}

/**
 * 背後の自動同期（マウント / シナリオ変更のたびに 1 回走る `useSyncDomains`）を実行してよいか。
 * 一覧の中でもっとも新しい `syncedAt` が 60 秒未満なら、まだ十分新しいのでスキップする。
 */
export function shouldAutoSync(
  domains: readonly DomainSummary[],
  now: Date,
): boolean {
  const syncedAt = latestSyncedAt(domains);
  if (syncedAt === null) {
    return true;
  }
  const elapsed = now.getTime() - new Date(syncedAt).getTime();
  return elapsed >= AUTO_SYNC_FRESHNESS_MS;
}

export default function DashboardPage() {
  const domains = useDomains();
  const sync = useSyncDomains();
  const scope = useQueryScope();
  const [dismissedError, setDismissedError] = useState<ApiClientError | null>(
    null,
  );

  // シナリオ（?mock=）が変わったら 1 回だけ背後で同期し直す。ただしすでに十分新しければスキップする
  const syncedScopeRef = useRef<string | null>(null);
  const syncMutate = sync.mutate;
  const listLoaded = domains.isSuccess;
  const loadedDomains = domains.data;
  useEffect(() => {
    if (!listLoaded || syncedScopeRef.current === scope) {
      return;
    }
    syncedScopeRef.current = scope;
    if (shouldAutoSync(loadedDomains ?? [], new Date())) {
      syncMutate();
    }
  }, [listLoaded, scope, syncMutate, loadedDomains]);

  const now = new Date();
  const list = visibleDomains(domains.data ?? []);
  const lastSyncedAt = latestSyncedAt(list);
  const hasStale = list.some((domain) => domain.stale);

  const refreshing = sync.isPending;
  const refreshButton = (
    <Button
      leadingIcon={<RefreshCw />}
      loading={refreshing}
      onClick={() => sync.mutate()}
      size="sm"
      variant="outline"
    >
      {refreshing ? "最新化中…" : "最新化"}
    </Button>
  );

  const syncedMeta =
    lastSyncedAt === null
      ? ""
      : ` · 最終同期 ${formatRelativeTime(lastSyncedAt, now)}`;
  const metaText = domains.isPending
    ? "読み込み中…"
    : domains.isError
      ? undefined
      : `${list.length}件${syncedMeta}${hasStale ? "（キャッシュ）" : ""}`;
  const meta =
    metaText === undefined ? undefined : (
      <span className="inline-flex items-center gap-1">
        {metaText}
        {domains.isSuccess ? (
          <HelpTip
            content={
              hasStale
                ? "レジストリに繋がらなかったので、前回取り込んだ内容を表示しています。「最新化」で取り直せます。"
                : "レジストリから最後に取り込んだ時刻です。開くたびに自動で最新化され、「最新化」でいつでも取り直せます。"
            }
            label="最終同期とは"
          />
        ) : null}
      </span>
    );

  let content: ReactNode;
  if (domains.isPending) {
    content = <DomainGridSkeleton />;
  } else if (domains.isError) {
    content = (
      <ErrorCard
        error={domains.error}
        onRetry={() => {
          void domains.refetch();
        }}
        showLogsLink
      />
    );
  } else if (list.length === 0) {
    content = (
      <EmptyState
        body="AI がニックネームやアプリ名から候補を考えます。まずは 1 つ取ってみましょう。他社のドメインを持ち込むこともできます。"
        className="mx-auto mt-10 max-w-120"
        primary={
          <Button asChild leadingIcon={<Plus />}>
            <Link href="/domains/new">ドメインを取得</Link>
          </Button>
        }
        secondary={
          <Button asChild variant="subtle">
            <Link href="/transfers">移管で持ち込む</Link>
          </Button>
        }
        title="まだドメインがありません"
      />
    );
  } else {
    content = <DomainGrid domains={list} now={now} />;
  }

  const syncError = sync.error;
  const showSyncBanner =
    syncError !== null && syncError !== dismissedError && !domains.isError;

  return (
    <>
      {showSyncBanner ? (
        <Banner
          body={syncErrorBody(lastSyncedAt, now)}
          onClose={() => setDismissedError(syncError)}
          title={syncErrorTitle(syncError, list)}
          tone="warn"
        />
      ) : null}
      <PageHeader
        action={refreshButton}
        {...(meta === undefined ? {} : { meta })}
        title="保有ドメイン"
      />
      {content}
    </>
  );
}
