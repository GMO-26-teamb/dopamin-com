"use client";

import { Zap } from "lucide-react";
import { type ReactNode, useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorCard } from "@/components/ui/error-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useApplyDns,
  useDnsDiff,
  useProposeSubdomains,
  useSaveSubdomainPlan,
  useSubdomainPlan,
} from "@/lib/api/hooks";
import type { SubdomainHost, SubdomainPlan } from "@/lib/api/types";
import { toErrorCopy } from "@/lib/error-messages";
import { ApplyDnsDialog } from "./apply-dns-dialog";
import { ApplySection } from "./apply-section";
import {
  appliedSummary,
  countApplyStatus,
  diffTotal,
  nextHostId,
  nextHostName,
} from "./apply-status";
import { EditPanel } from "./edit-panel";
import { ManualInstructions } from "./manual-instructions";
import { DescriptionForm, RepoForm } from "./repo-form";
import { PlanTree } from "./tree";

/**
 * サブドメイン設計（FR-13 / S-40 〜 S-46）。
 *
 * - S-40   設計なし。リポ URL を入れて「リポジトリを解析」
 * - S-40b  保存済み設計の読み込み中（Skeleton）
 * - S-41   解析中（ボタン Disabled +「解析中…」）
 * - S-42   リポ取得失敗 → 概要から提案（AC-13-2）
 * - S-43   提案・編集（ツリー + 編集パネル + DNS 反映セクション + 手順テキスト）
 * - S-44   反映確認ダイアログ（AC-13-7、`ApplyDnsDialog`）
 * - S-45   反映後 Banner Ok + 全ノード「反映済み」（AC-13-4）
 * - S-46   NS 切替失敗 → Banner Warn、レコードは未変更（AC-13-5）
 */

const S40_TITLE = "リポジトリを解析して構成を提案します";
const S40_BODY =
  "README・ディレクトリ構成・マニフェストから www / api / docs などのホストを提案します（15 秒以内）。非公開リポの場合はプロジェクト概要のテキストでも提案できます。";
const S41_NOTE =
  "解析中… GitHub からリポジトリ情報を取得し、AI が構成を提案しています（最大 15 秒）";
const S42_TITLE = "リポジトリを取得できません";
const S42_BODY =
  "存在しないか非公開です（GitHub 404）。代わりにプロジェクトの概要を入力すると、そこから構成を提案します。";
const AI_RETRY_BODY =
  "もう一度お試しください。プロジェクト概要を入力して提案することもできます。";
const NS_FAIL_TITLE = "ネームサーバーの切替に失敗しました";
const NS_FAIL_BODY =
  "NS をドパ民 DNS に切り替えられなかったため、レコードは変更していません。再同期してから、もう一度お試しください。";

interface ProposeInput {
  repoUrl?: string;
  description?: string;
}

interface ScreenBanner {
  tone: "ok" | "warn";
  title: string;
  body: string;
  onRetry?: () => void;
}

export interface SubdomainsScreenProps {
  domain: string;
}

export function SubdomainsScreen({ domain }: SubdomainsScreenProps) {
  const plan = useSubdomainPlan(domain);
  const propose = useProposeSubdomains(domain);
  const save = useSaveSubdomainPlan(domain);
  const apply = useApplyDns(domain);

  const planData = plan.data ?? null;
  const hasPlan = planData !== null;
  // 設計が無い間は差分も存在しない（サーバーは 404）ので、空の domain で query を止める
  const diff = useDnsDiff(hasPlan ? domain : "");

  const [syncedPlan, setSyncedPlan] = useState<SubdomainPlan | null>(null);
  const [draft, setDraft] = useState<SubdomainPlan | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [repoUrl, setRepoUrl] = useState("");
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [banner, setBanner] = useState<ScreenBanner | null>(null);

  // 取得した設計を編集用の下書きに写す（保存・反映のたびに取り直される）
  if (planData !== syncedPlan) {
    const hosts = planData?.hosts ?? [];
    setSyncedPlan(planData);
    setDraft(planData);
    setRepoUrl(planData?.repoUrl ?? "");
    setSelectedId((current) =>
      current !== null && hosts.some((host) => host.id === current)
        ? current
        : (hosts[0]?.id ?? null),
    );
  }

  const dirty = draft !== null && draft !== syncedPlan;
  const selected =
    draft?.hosts.find((host) => host.id === selectedId) ??
    draft?.hosts[0] ??
    null;

  const diffPending = hasPlan && diff.isPending;
  const diffError = hasPlan ? diff.error : null;
  const diffData = diff.data;
  const applyDisabled =
    !hasPlan ||
    dirty ||
    diffPending ||
    diffError !== null ||
    diffData === undefined ||
    diffTotal(diffData) === 0 ||
    apply.isPending;

  function runPropose(input: ProposeInput): void {
    setBanner(null);
    propose.mutate(input, {
      onSuccess: () => setDescriptionOpen(false),
      onError: (error) => {
        if (error.origin === "ai") {
          // AI 失敗は S-40 に戻して Banner Warn + 再試行（ui-screens §3）
          setBanner({
            body: AI_RETRY_BODY,
            onRetry: () => runPropose(input),
            title: toErrorCopy(error).title,
            tone: "warn",
          });
        } else {
          // S-42: リポジトリを取得できなかったので概要入力を開く（AC-13-2）
          setDescriptionOpen(true);
        }
      },
    });
  }

  function updateDraft(next: SubdomainPlan): void {
    setDraft(next);
    save.reset();
  }

  function updateHost(next: SubdomainHost): void {
    if (draft === null) {
      return;
    }
    updateDraft({
      ...draft,
      hosts: draft.hosts.map((host) => (host.id === next.id ? next : host)),
    });
  }

  function addHost(): void {
    if (draft === null) {
      return;
    }
    const host: SubdomainHost = {
      applyStatus: "pending",
      host: nextHostName(draft.hosts),
      id: nextHostId(draft.hosts),
      priority: "optional",
      purpose: "",
      recordType: "CNAME",
      target: "",
    };
    updateDraft({ ...draft, hosts: [...draft.hosts, host] });
    setSelectedId(host.id);
  }

  function removeHost(id: string): void {
    if (draft === null) {
      return;
    }
    const hosts = draft.hosts.filter((host) => host.id !== id);
    updateDraft({ ...draft, hosts });
    setSelectedId(hosts[0]?.id ?? null);
  }

  function onSave(): void {
    if (draft === null) {
      return;
    }
    setBanner(null);
    save.mutate(draft);
  }

  function openApplyDialog(): void {
    apply.reset();
    setDialogOpen(true);
  }

  function onApply(): void {
    apply.mutate(undefined, {
      onSuccess: (result) => {
        setDialogOpen(false);
        // NS を切り替えられなかったときはレコードも変えていない（AC-13-5 / S-46）
        setBanner(
          result.plan.nameserversSwitched
            ? {
                body: `${result.plan.hosts.length} ホストを反映（${appliedSummary(result)}）・ネームサーバーはドパ民 DNS`,
                title: "DNS に反映しました",
                tone: "ok",
              }
            : { body: NS_FAIL_BODY, title: NS_FAIL_TITLE, tone: "warn" },
        );
      },
    });
  }

  // メイン先頭のバナーは常に 1 つだけ（ui-screens §1）。反映結果 > 差分取得の失敗
  const shownBanner: ScreenBanner | null =
    banner ??
    (diffError === null
      ? null
      : {
          body: toErrorCopy(diffError).body,
          onRetry: () => {
            void diff.refetch();
          },
          title: toErrorCopy(diffError).title,
          tone: "warn",
        });

  let body: ReactNode;
  if (plan.isPending) {
    // S-40b: 保存済み設計の読み込み
    body = (
      <div className="flex w-full flex-col gap-2">
        <Skeleton shape="block" />
        <Skeleton className="w-2/3" shape="block" />
        <Skeleton className="w-1/2" shape="block" />
      </div>
    );
  } else if (plan.error !== null) {
    body = (
      <ErrorCard
        error={plan.error}
        onRetry={() => {
          void plan.refetch();
        }}
        showLogsLink
      />
    );
  } else if (propose.isPending) {
    // S-41: 解析中
    body = (
      <div className="flex w-full flex-col gap-2">
        <Skeleton shape="block" />
        <Skeleton className="w-1/2" shape="block" />
        <Skeleton className="w-5/12" shape="block" />
        <Skeleton className="w-1/3" shape="block" />
        <p className="w-full text-caption text-muted">{S41_NOTE}</p>
      </div>
    );
  } else if (
    draft === null &&
    propose.error !== null &&
    propose.error.origin !== "ai"
  ) {
    // S-42: リポ取得失敗（NOT_FOUND / RATE_LIMITED は同じ画面で文言差し替え）
    const copy = toErrorCopy(propose.error);
    const notFound = propose.error.code === "NOT_FOUND";
    body = (
      <>
        <EmptyState
          body={notFound ? S42_BODY : copy.body}
          title={notFound ? S42_TITLE : copy.title}
          tone="warn"
        />
        <DescriptionForm analyzing={false} onPropose={runPropose} />
      </>
    );
  } else if (draft === null) {
    // S-40: 設計なし
    body = (
      <>
        <EmptyState body={S40_BODY} title={S40_TITLE} />
        {descriptionOpen ? (
          <DescriptionForm analyzing={false} onPropose={runPropose} />
        ) : null}
      </>
    );
  } else {
    // S-43 / S-45 / S-46
    body = (
      <>
        <PolicyBar
          onChange={(policy) => updateDraft({ ...draft, policy })}
          policy={draft.policy}
        />
        <div className="flex w-full items-start gap-4">
          <div className="min-w-0 flex-1">
            <PlanTree
              domain={domain}
              hosts={draft.hosts}
              onAddHost={addHost}
              onSelect={setSelectedId}
              selectedId={selected?.id ?? null}
            />
          </div>
          <div className="flex w-96 shrink-0 flex-col gap-3 border-2 border-line border-solid bg-panel px-4 py-3">
            {selected === null ? (
              <p className="w-full text-body-sm text-muted">
                ホストを追加すると編集できます。
              </p>
            ) : (
              <EditPanel
                host={selected}
                onChange={updateHost}
                onRemove={() => removeHost(selected.id)}
              />
            )}
            <ApplySection
              applying={apply.isPending}
              counts={countApplyStatus(draft.hosts)}
              diff={diffData}
              diffFailed={diffError !== null}
              diffPending={diffPending}
              dirty={dirty}
              nameserversSwitched={draft.nameserversSwitched}
              onApply={openApplyDialog}
            />
            <ManualInstructions hosts={draft.hosts} />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {shownBanner === null ? null : (
        <Banner
          action={
            shownBanner.onRetry === undefined ? undefined : (
              <Button onClick={shownBanner.onRetry} size="sm" variant="outline">
                再試行
              </Button>
            )
          }
          body={shownBanner.body}
          onClose={() => setBanner(null)}
          title={shownBanner.title}
          tone={shownBanner.tone}
        />
      )}

      <PageHeader
        action={
          <div className="flex shrink-0 items-center gap-2">
            <Button
              disabled={draft === null || save.isPending || apply.isPending}
              loading={save.isPending}
              onClick={onSave}
              variant="outline"
            >
              {save.isPending ? "保存中…" : "設計を保存"}
            </Button>
            <Button
              disabled={applyDisabled}
              leadingIcon={<Zap />}
              onClick={openApplyDialog}
              variant="primary"
            >
              DNS に反映
            </Button>
          </div>
        }
        meta={domain}
        title="サブドメイン設計"
      />

      {plan.error === null ? (
        <RepoForm
          analyzing={propose.isPending}
          descriptionOpen={descriptionOpen}
          onDescriptionOpenChange={setDescriptionOpen}
          onPropose={runPropose}
          onRepoUrlChange={setRepoUrl}
          repoUrl={repoUrl}
        />
      ) : null}

      {save.error === null ? null : <ErrorCard error={save.error} />}

      {body}

      {draft === null ? null : (
        <ApplyDnsDialog
          applying={apply.isPending}
          diff={diffData}
          domain={domain}
          error={apply.error}
          loading={diffPending}
          nameserversSwitched={draft.nameserversSwitched}
          onApply={onApply}
          onOpenChange={setDialogOpen}
          open={dialogOpen}
        />
      )}
    </>
  );
}

/** 全体方針（AI の提案・編集可）。S-43 のツリー上のバー。 */
function PolicyBar({
  policy,
  onChange,
}: {
  policy: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex w-full items-center gap-2 border-2 border-line border-solid bg-panel px-3 py-2">
      <span className="shrink-0 text-label text-ink">全体方針</span>
      <input
        aria-label="全体方針"
        className="min-w-0 flex-1 bg-transparent text-body-sm text-ink focus:outline-none"
        onChange={(event) => onChange(event.target.value)}
        value={policy}
      />
      <span className="shrink-0 text-caption text-muted">
        AI の提案・編集可
      </span>
    </div>
  );
}
