"use client";

import type { DomainCheckRequest } from "@dopamin/shared";
import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorCard } from "@/components/ui/error-card";
import {
  CandidateForm,
  type CandidateFormValues,
} from "@/features/candidates/candidate-form";
import {
  CandidateGrid,
  CandidateGridSkeleton,
} from "@/features/candidates/candidate-grid";
import {
  DirectSearch,
  type SearchSummary,
} from "@/features/candidates/direct-search";
import {
  RegisterDialog,
  type RegisterTarget,
} from "@/features/candidates/register-dialog";
import {
  type ReconcileOutcome,
  RegisterConflictDialog,
  type RegisterSuccess,
  RegisterSuccessDialog,
  RegisterTimeoutDialog,
} from "@/features/candidates/register-result-dialogs";
import { DEFAULT_TLDS } from "@/features/candidates/tlds";
import type { ApiClientError } from "@/lib/api/errors";
import { useCheckDomains, useGenerateCandidates } from "@/lib/api/hooks";
import type {
  Candidate,
  DomainDetail,
  PaymentReceipt,
  SearchResult,
  UniquenessScore,
} from "@/lib/api/types";
import { toErrorCopy } from "@/lib/error-messages";

/**
 * ui-screens S-20〜S-28（`/domains/new`、FR-03 / 04 / 05 / 06）。
 * AI 候補（S-20〜S-23）と直接検索（S-24）の 2 経路から、同じ登録ダイアログ（S-25）に入る。
 * `?mock=` の各シナリオ: 既定 = S-22 / `loading` = S-21 / `ai-timeout`・`error` = S-23 /
 * `partial-failure` = S-24 の確認不可行 / `conflict` = S-27 / `error` = S-28。
 */

/** `POST /domains/check` の `names` は最大 20 件（domainCheckRequestSchema）。 */
const MAX_CHECK_NAMES = 20;
const S28_NOTICE = "登録は行われていません";

export default function DomainsNewPage() {
  const router = useRouter();
  const generate = useGenerateCandidates();
  const search = useCheckDomains();
  const recheck = useCheckDomains();

  const [lastInput, setLastInput] = useState<CandidateFormValues | null>(null);
  const [excluded, setExcluded] = useState<readonly string[]>([]);
  // 希望 TLD は 1 つだけ持ち、AI 候補と直接検索で共有する（#218）
  const [tlds, setTlds] = useState<readonly string[]>(DEFAULT_TLDS);
  // 主導線は AI 候補。直接検索は畳んだ二次導線として置く（#218）
  const [searchOpen, setSearchOpen] = useState(false);
  const [summary, setSummary] = useState<SearchSummary | null>(null);
  // 直前に投げた check。Error Card の「再試行」で同じ条件をそのまま送り直す（S-24）
  const [lastSearch, setLastSearch] = useState<DomainCheckRequest | null>(null);
  // 「再試行」で個別に取り直した結果。候補・検索結果に上書きで重ねる（AC-03-2 / AC-05-2）
  const [overrides, setOverrides] = useState<Record<string, SearchResult>>({});
  const [registeredNames, setRegisteredNames] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [retryingName, setRetryingName] = useState<string | null>(null);
  const [target, setTarget] = useState<RegisterTarget | null>(null);
  const [lastTarget, setLastTarget] = useState<RegisterTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [success, setSuccess] = useState<RegisterSuccess | null>(null);
  const [conflict, setConflict] = useState<{
    name: string;
    alternatives: readonly string[];
  } | null>(null);
  const [registryTimeout, setRegistryTimeout] = useState<{
    name: string;
    error: ApiClientError;
  } | null>(null);

  const candidates = useMemo(
    () =>
      (generate.data ?? []).map((candidate) => {
        const found = overrides[`${candidate.sld}.${candidate.tld}`];
        return found === undefined
          ? candidate
          : {
              ...candidate,
              availability: found.availability,
              uniqueness: found.uniqueness,
              alternatives: found.alternatives,
            };
      }),
    [generate.data, overrides],
  );

  const results = useMemo(
    () => search.data?.map((row) => overrides[row.name] ?? row),
    [search.data, overrides],
  );

  const runGenerate = useCallback(
    (values: CandidateFormValues, exclude: readonly string[]) => {
      setLastInput(values);
      setExcluded(exclude);
      generate.mutate(
        {
          ...values,
          ...(exclude.length === 0 ? {} : { exclude: [...exclude] }),
        },
        {
          onSuccess: (list) => {
            setOverrides({});
            if (list.length > 0) {
              // 候補が出たら直接検索は畳む（Figma S-22）
              setSearchOpen(false);
            }
          },
          onError: () => setSearchOpen(true),
        },
      );
    },
    [generate],
  );

  const handleRegenerate = useCallback(() => {
    if (lastInput === null) {
      return;
    }
    const shown = candidates.map((c) => `${c.sld}.${c.tld}`);
    runGenerate(lastInput, [...new Set([...excluded, ...shown])]);
  }, [candidates, excluded, lastInput, runGenerate]);

  const handleSearch = useCallback(
    (request: DomainCheckRequest, next: SearchSummary) => {
      setSummary(next);
      setLastSearch(request);
      search.mutate(request, { onSuccess: () => setOverrides({}) });
    },
    [search],
  );

  const handleRetrySearch = useCallback(() => {
    if (lastSearch === null || summary === null) {
      return;
    }
    handleSearch(lastSearch, summary);
  }, [handleSearch, lastSearch, summary]);

  const handleShowAlternatives = useCallback(
    (names: string[]) => {
      setConflict(null);
      setSearchOpen(true);
      if (names.length === 0) {
        return;
      }
      const picked = names.slice(0, MAX_CHECK_NAMES);
      handleSearch(
        { names: picked },
        { label: "代替候補", tldCount: null, rowCount: picked.length },
      );
    },
    [handleSearch],
  );

  const handleRetry = useCallback(
    (name: string) => {
      setRetryingName(name);
      recheck.mutate(
        { names: [name] },
        {
          onSuccess: (rows) => {
            const row = rows[0];
            if (row !== undefined) {
              setOverrides((prev) => ({ ...prev, [row.name]: row }));
            }
          },
          onSettled: () => setRetryingName(null),
        },
      );
    },
    [recheck],
  );

  const openRegister = useCallback(
    (name: string, uniqueness: UniquenessScore | null) => {
      setNotice(null);
      const next = { name, uniqueness };
      setTarget(next);
      setLastTarget(next);
    },
    [],
  );

  const handleRegisterCandidate = useCallback(
    (candidate: Candidate) =>
      openRegister(`${candidate.sld}.${candidate.tld}`, candidate.uniqueness),
    [openRegister],
  );

  const handleRegisterResult = useCallback(
    (result: SearchResult) => openRegister(result.name, result.uniqueness),
    [openRegister],
  );

  const handleRegistered = useCallback(
    (domain: DomainDetail, receipt: PaymentReceipt) => {
      setTarget(null);
      setRegisteredNames((prev) => new Set([...prev, domain.name]));
      setSuccess({ domain, receipt });
    },
    [],
  );

  const handleConflict = useCallback((name: string, alternatives: string[]) => {
    setTarget(null);
    setRegistryTimeout(null);
    setConflict({ name, alternatives });
  }, []);

  const handleTimeout = useCallback((name: string, error: ApiClientError) => {
    setTarget(null);
    setRegistryTimeout({ name, error });
  }, []);

  const handleReconciled = useCallback(
    (outcome: ReconcileOutcome) => {
      setRegistryTimeout(null);
      if (outcome.kind === "registered") {
        setRegisteredNames((prev) => new Set([...prev, outcome.domain.name]));
        router.push(`/domains/${outcome.domain.name}`);
        return;
      }
      if (outcome.kind === "taken") {
        setConflict({
          name: lastTarget?.name ?? "",
          alternatives: outcome.alternatives,
        });
        return;
      }
      // 空きのまま = 登録は行われていない。S-25 に戻して再送できるようにする
      setNotice(S28_NOTICE);
      setTarget(lastTarget);
    },
    [lastTarget, router],
  );

  // 行ごとの「再試行」が落ちたときに黙って元の表示に戻らないよう、帯で知らせる（AC-03-2）
  const recheckCopy =
    recheck.error === null ? null : toErrorCopy(recheck.error);

  return (
    <>
      <PageHeader title="名前を考える" />

      {recheckCopy === null ? null : (
        <Banner
          body={recheckCopy.body}
          onClose={() => recheck.reset()}
          title={`再確認できませんでした — ${recheckCopy.title}`}
          tone="warn"
        />
      )}

      <CandidateForm
        busy={generate.isPending}
        onSubmit={(values) => runGenerate(values, [])}
        onTldsChange={setTlds}
        tlds={tlds}
      />

      <CandidateArea
        candidates={candidates}
        error={generate.error}
        idle={!generate.isPending && generate.data === undefined}
        onRegister={handleRegisterCandidate}
        onRetry={handleRetry}
        onRetryGenerate={() => {
          if (lastInput !== null) {
            runGenerate(lastInput, excluded);
          }
        }}
        onShowAlternatives={handleShowAlternatives}
        pending={generate.isPending}
        registeredNames={registeredNames}
        retryingName={retryingName}
      />

      {candidates.length === 0 || generate.isPending ? null : (
        <div className="flex w-full items-center gap-3">
          <Button
            leadingIcon={<RotateCcw />}
            onClick={handleRegenerate}
            variant="outline"
          >
            もう一回考える
          </Button>
          <p className="text-caption text-muted">
            前回の候補は除外して再生成します
          </p>
        </div>
      )}

      <DirectSearch
        busy={search.isPending}
        error={search.error}
        onOpenChange={setSearchOpen}
        onRegister={handleRegisterResult}
        onRetry={handleRetry}
        onRetrySearch={handleRetrySearch}
        onSearch={handleSearch}
        onShowAlternatives={handleShowAlternatives}
        onTldsChange={setTlds}
        open={searchOpen}
        registeredNames={registeredNames}
        results={results}
        retryingName={retryingName}
        summary={summary}
        tlds={tlds}
      />

      <RegisterDialog
        notice={notice}
        onConflict={handleConflict}
        onOpenChange={(open) => {
          if (!open) {
            setTarget(null);
          }
        }}
        onRegistered={handleRegistered}
        onTimeout={handleTimeout}
        target={target}
      />
      <RegisterSuccessDialog
        success={success}
        onGoToDetail={(name) => router.push(`/domains/${name}`)}
        onGoToSubdomains={(name) => router.push(`/domains/${name}/subdomains`)}
        onOpenChange={(open) => {
          if (!open) {
            setSuccess(null);
          }
        }}
      />
      <RegisterConflictDialog
        conflict={conflict}
        onOpenChange={(open) => {
          if (!open) {
            setConflict(null);
          }
        }}
        onShowAlternatives={handleShowAlternatives}
      />
      <RegisterTimeoutDialog
        onOpenChange={(open) => {
          if (!open) {
            setRegistryTimeout(null);
          }
        }}
        onOutcome={handleReconciled}
        timeout={registryTimeout}
      />
    </>
  );
}

interface CandidateAreaProps {
  pending: boolean;
  idle: boolean;
  error: ApiClientError | null;
  candidates: readonly Candidate[];
  registeredNames: ReadonlySet<string>;
  retryingName: string | null;
  onRegister: (candidate: Candidate) => void;
  onShowAlternatives: (names: string[]) => void;
  onRetry: (name: string) => void;
  onRetryGenerate: () => void;
}

/** S-20（案内）/ S-21（生成中）/ S-22（候補）/ S-23（AI エラー）の出し分け。 */
function CandidateArea({
  pending,
  idle,
  error,
  candidates,
  registeredNames,
  retryingName,
  onRegister,
  onShowAlternatives,
  onRetry,
  onRetryGenerate,
}: CandidateAreaProps) {
  if (pending) {
    return <CandidateGridSkeleton />;
  }

  // S-23: AI のタイムアウト / AI_UNAVAILABLE / RATE_LIMITED。文言は origin="ai" 側を使う
  if (error !== null) {
    return <ErrorCard error={error} onRetry={onRetryGenerate} showLogsLink />;
  }

  if (idle) {
    return (
      <EmptyState
        body="ニックネームから空いている名前を 6 件そろえます。"
        title="AI に候補を考えてもらう"
      />
    );
  }

  if (candidates.length === 0) {
    return (
      <EmptyState
        body="希望 TLD を広げるか、キーワードを変えてもう一度お試しください。"
        title="候補が見つかりませんでした"
      />
    );
  }

  return (
    <CandidateGrid
      candidates={candidates}
      onRegister={onRegister}
      onRetry={onRetry}
      onShowAlternatives={onShowAlternatives}
      registeredNames={registeredNames}
      retryingName={retryingName}
    />
  );
}
