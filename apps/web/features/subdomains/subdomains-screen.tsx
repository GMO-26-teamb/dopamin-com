"use client";

import { type ReactNode, useId, useState } from "react";
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
  nextHostId,
  nextHostName,
} from "./apply-status";
import { EditPanel } from "./edit-panel";
import { ManualInstructions } from "./manual-instructions";
import { DescriptionForm, RepoForm } from "./repo-form";
import { PlanTree } from "./tree";
import { canAddHost, hostFieldErrors, validatePlan } from "./validate";

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
 *
 * 保存は `validate.ts` で契約（`savedSubdomainProposalSchema`）を満たすか先に見る。
 * 満たさない場合はサーバーに投げず、該当ホストを選び直して欄にエラーを出す。
 */

const S40_TITLE = "リポジトリを解析して構成を提案します";
const S40_BODY =
  "リポジトリの構成から www / api などのホストを提案します。非公開なら概要テキストからでも提案できます。";
const S41_NOTE = "解析中… 最大 30 秒かかります。";
const S42_TITLE = "リポジトリを取得できません";
const S42_BODY =
  "見つからないか、非公開です。プロジェクトの概要からでも提案できます。";
const AI_RETRY_BODY = "もう一度お試しください。概要からでも提案できます。";
const NS_FAIL_TITLE = "ネームサーバーの切替に失敗しました";
const NS_FAIL_BODY = "レコードは変更していません。もう一度お試しください。";

interface ProposeInput {
  repoUrl?: string;
  description?: string;
}

interface ScreenBanner {
  tone: "ok" | "warn";
  title: string;
  body: string;
  onRetry?: () => void;
  /** 閉じたときの後始末。派生バナー（再解析 / 差分の失敗）は「閉じた」印を付ける */
  onClose: () => void;
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
  const [dismissedProposeError, setDismissedProposeError] = useState(false);
  const [dismissedDiffError, setDismissedDiffError] = useState(false);
  // 保存を押すまでは欄を赤くしない（D-02 のネームサーバー編集と同じ扱い）
  const [submitted, setSubmitted] = useState(false);

  // 取得した設計を編集用の下書きに写す（保存・反映のたびに取り直される）
  if (planData !== syncedPlan) {
    const hosts = planData?.hosts ?? [];
    setSyncedPlan(planData);
    setDraft(planData);
    setRepoUrl(planData?.repoUrl ?? "");
    setSubmitted(false);
    setSelectedId((current) =>
      current !== null && hosts.some((host) => host.id === current)
        ? current
        : (hosts[0]?.id ?? null),
    );
  }

  // 提案されたばかりの設計（`savedAt === null`）も未保存扱い。
  // 反映は保存済み設計に対して行うので、先に「設計を保存」が要る（FR-13）
  const dirty =
    draft !== null && (draft !== syncedPlan || draft.savedAt === null);
  const selected =
    draft?.hosts.find((host) => host.id === selectedId) ??
    draft?.hosts[0] ??
    null;

  // 保存できない理由（件数・全体方針・各ホストの欄）。null なら PUT してよい
  const planError = draft === null ? null : validatePlan(draft);
  const fieldErrors =
    submitted && draft !== null && selected !== null
      ? hostFieldErrors(selected, draft.hosts)
      : {};

  // Primary は 1 画面 1 つ（`components/ui/button.tsx`）。設計があるときは反映セクションの
  // 「DNS に反映」、無いときは提案の導線（概要入力が開いていれば「概要から提案」）が Primary。
  const repoFailed = propose.error !== null && propose.error.origin !== "ai";
  const proposeFromDescription = draft === null && descriptionOpen;
  const analyzePrimary = draft === null && !proposeFromDescription;

  const diffPending = hasPlan && diff.isPending;
  const diffError = hasPlan ? diff.error : null;
  const diffData = diff.data;

  function runPropose(input: ProposeInput): void {
    setBanner(null);
    setDismissedProposeError(false);
    propose.mutate(input, {
      onSuccess: () => setDescriptionOpen(false),
      onError: (error) => {
        if (error.origin === "ai") {
          // AI 失敗は S-40 に戻して Banner Warn + 再試行（ui-screens §3）
          setBanner({
            body: AI_RETRY_BODY,
            onClose: () => setBanner(null),
            onRetry: () => runPropose(input),
            title: toErrorCopy(error).title,
            tone: "warn",
          });
        } else {
          // S-42 / S-43 の再解析: リポを取得できなかったので概要入力を開く（AC-13-2）
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
    setSubmitted(true);
    if (planError !== null) {
      // サーバーに投げれば 400 が返るだけなので、該当ホストを開いて欄で直させる
      if (planError.hostId !== null) {
        setSelectedId(planError.hostId);
      }
      return;
    }
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
                onClose: () => setBanner(null),
                title: "DNS に反映しました",
                tone: "ok",
              }
            : {
                body: NS_FAIL_BODY,
                onClose: () => setBanner(null),
                title: NS_FAIL_TITLE,
                tone: "warn",
              },
        );
      },
    });
  }

  // S-43 の再解析失敗。設計が無いときは S-42 の Empty State で見せるのでここには出さない
  const retryProposeError =
    draft !== null && propose.error !== null && propose.error.origin !== "ai"
      ? propose.error
      : null;

  // メイン先頭のバナーは常に 1 つだけ（ui-screens §1）。反映結果 > 再解析の失敗 > 差分取得の失敗
  function deriveBanner(): ScreenBanner | null {
    if (banner !== null) {
      return banner;
    }
    if (retryProposeError !== null && !dismissedProposeError) {
      const copy = toErrorCopy(retryProposeError);
      const notFound = retryProposeError.code === "NOT_FOUND";
      return {
        body: notFound ? S42_BODY : copy.body,
        onClose: () => setDismissedProposeError(true),
        title: notFound ? S42_TITLE : copy.title,
        tone: "warn",
      };
    }
    if (diffError !== null && !dismissedDiffError) {
      const copy = toErrorCopy(diffError);
      return {
        body: copy.body,
        onClose: () => setDismissedDiffError(true),
        onRetry: () => {
          setDismissedDiffError(false);
          void diff.refetch();
        },
        title: copy.title,
        tone: "warn",
      };
    }
    return null;
  }

  const shownBanner = deriveBanner();

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
        <DescriptionForm
          analyzing={false}
          onPropose={runPropose}
          proposePrimary
        />
      </>
    );
  } else if (draft === null) {
    // S-40: 設計なし
    body = (
      <>
        <EmptyState body={S40_BODY} title={S40_TITLE} />
        {descriptionOpen ? (
          <DescriptionForm
            analyzing={false}
            onPropose={runPropose}
            proposePrimary
          />
        ) : null}
      </>
    );
  } else {
    // S-43 / S-45 / S-46
    body = (
      <>
        {descriptionOpen ? (
          // 設計があっても「概要を書いて提案」で再提案できる（再解析の失敗時は自動で開く）。
          // このときの Primary は下段の「DNS に反映」なので、ここは outline のまま
          <DescriptionForm analyzing={false} onPropose={runPropose} />
        ) : null}
        <PolicyBar
          onChange={(policy) => updateDraft({ ...draft, policy })}
          policy={draft.policy}
        />
        {/* 上段は「設計する」（ツリー + 選択中ホストの編集）。反映は下段に分ける（#219） */}
        <div className="flex w-full flex-col items-start gap-4 lg:flex-row">
          <div className="flex w-full min-w-0 flex-1 flex-col border-2 border-line border-solid bg-panel px-4 py-3">
            <PlanTree
              canAdd={canAddHost(draft.hosts)}
              domain={domain}
              hosts={draft.hosts}
              onAddHost={addHost}
              onSelect={setSelectedId}
              selectedId={selected?.id ?? null}
            />
          </div>
          <div className="flex w-full shrink-0 flex-col gap-3 border-2 border-line border-solid bg-panel px-4 py-3 lg:w-96">
            {selected === null ? (
              <p className="w-full text-body-sm text-muted">
                ホストを追加すると編集できます。
              </p>
            ) : (
              <EditPanel
                errors={fieldErrors}
                host={selected}
                onChange={updateHost}
                onRemove={() => removeHost(selected.id)}
              />
            )}
          </div>
        </div>
        {/* 下段は「反映する」。設計全体の状態と実行なので幅いっぱいに置く */}
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
          onClose={shownBanner.onClose}
          title={shownBanner.title}
          tone={shownBanner.tone}
        />
      )}

      <PageHeader
        action={
          <Button
            disabled={!dirty || save.isPending || apply.isPending}
            loading={save.isPending}
            onClick={onSave}
            variant="outline"
          >
            {save.isPending ? "保存中…" : "設計を保存"}
          </Button>
        }
        meta={domain}
        title="サブドメイン設計"
      />

      {plan.error === null ? (
        <RepoForm
          analyzePrimary={analyzePrimary}
          analyzing={propose.isPending}
          descriptionOpen={descriptionOpen}
          onDescriptionOpenChange={setDescriptionOpen}
          onPropose={runPropose}
          onRepoUrlChange={setRepoUrl}
          recovering={repoFailed}
          repoUrl={repoUrl}
        />
      ) : null}

      {submitted && planError !== null ? (
        <p className="w-full text-caption text-warn" role="alert">
          {planError.message}
        </p>
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

/** 全体方針（AI が提案し、そのまま編集できる）。S-43 のツリー上のバー。 */
function PolicyBar({
  policy,
  onChange,
}: {
  policy: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex w-full items-center gap-2 border-2 border-line border-solid bg-panel px-3 py-2">
      <label className="shrink-0 text-label text-ink" htmlFor={id}>
        全体方針
      </label>
      <input
        className="min-w-0 flex-1 bg-transparent text-body-sm text-ink focus:outline-none"
        id={id}
        name="policy"
        onChange={(event) => onChange(event.target.value)}
        value={policy}
      />
    </div>
  );
}
