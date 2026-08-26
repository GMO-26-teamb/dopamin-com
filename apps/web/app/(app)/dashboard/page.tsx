"use client";

import { Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorCard } from "@/components/ui/error-card";
import { HelpTip } from "@/components/ui/help-tip";
import { latestSyncedAt, shouldAutoSync } from "@/features/domains/auto-sync";
import { DomainGridSkeleton } from "@/features/domains/domain-card-skeleton";
import { DomainGrid, visibleDomains } from "@/features/domains/domain-grid";
import { formatRelativeTime } from "@/features/domains/format";
import { syncNotice } from "@/features/domains/sync-notice";
import { useDomains, useSyncDomains } from "@/lib/api/hooks";
import { useQueryScope } from "@/lib/api/provider";

/**
 * S-10 保有ドメイン一覧 / S-11 0 件 / S-12 読み込み / S-13 同期エラー（FR-02・AC-18-1）。
 *
 * `GET /domains`（DB キャッシュ）を先に描画し、`POST /domains/sync` は背後で 1 回だけ走らせる
 * （ui-screens S-12）。同期に失敗したら Banner Warn を出し、キャッシュ表示を続ける。
 */

export default function DashboardPage() {
  const domains = useDomains();
  const sync = useSyncDomains();
  const scope = useQueryScope();
  // 閉じた Banner を覚えるキー。ハード失敗（error）と部分失敗（data）を
  // 同じ 1 本で扱えるよう、その同期試行の結果オブジェクトの同一性で比べる
  const [dismissed, setDismissed] = useState<object | null>(null);

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
    content = <DomainGrid domains={list} now={now} syncing={refreshing} />;
  }

  // 部分失敗（200 + failures）とリクエストごとの失敗（error）の両方をここで拾う。
  // 一覧そのものが取れていないときは Error Card が出ているので Banner は重ねない
  const syncOutcome: object | null = sync.error ?? sync.data ?? null;
  const notice = syncNotice({
    error: sync.error,
    failures: sync.data?.failures ?? [],
    domains: list,
    now,
  });
  const banner =
    notice !== null && syncOutcome !== dismissed && !domains.isError
      ? notice
      : null;

  return (
    <>
      {banner === null ? null : (
        <Banner
          body={banner.body}
          onClose={() => setDismissed(syncOutcome)}
          title={banner.title}
          tone="warn"
        />
      )}
      <PageHeader
        action={refreshButton}
        {...(meta === undefined ? {} : { meta })}
        title="保有ドメイン"
      />
      {content}
    </>
  );
}
