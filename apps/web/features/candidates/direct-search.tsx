"use client";

import type { DomainCheckRequest } from "@dopamin/shared";
import { rarityTier } from "@dopamin/shared";
import { ChevronDown, Search } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorCard } from "@/components/ui/error-card";
import { Input } from "@/components/ui/input";
import { Rarity } from "@/components/ui/rarity";
import { ScoreGauge } from "@/components/ui/score-gauge";
import { SimilarityRow } from "@/components/ui/similarity-row";
import { REGISTRY_LABEL } from "@/features/domains/registry-label";
import type { ApiClientError } from "@/lib/api/errors";
import type { SearchResult, UniquenessScore } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { gaugeTone, uniquenessText } from "./labels";
import { SearchResultRow, SearchResultRowSkeleton } from "./search-result-row";
import { TldMultiSelect } from "./tld-select";
import { parseSearchQuery, TLD_REQUIRED } from "./tlds";

/**
 * Figma: S-20 `81:741`（初期）/ S-24 `81:1156`（結果）
 * ui-screens S-24。SLD + TLD 複数選択、または `.` を含む入力を FQDN として 1 件で check する。
 * 一部のレジストリが応答しないときは「確認不可」の行を残したまま、他の結果を表示し続ける。
 *
 * AI 候補が主導線なので、この経路は畳んだ二次導線として置く（#218）。
 */

const HELPER = "英数字とハイフンだけ、63 文字以内で入力できます";
const TRIGGER_LABEL = "自分で入力して探す";

/** 何を検索したかの控え（結果カードの見出しに使う）。 */
export interface SearchSummary {
  label: string;
  /** SLD + TLD 一括のときだけ件数を出す（FQDN / 代替候補は null） */
  tldCount: number | null;
  /** 読み込み中に並べる Skeleton 行の数（= 送った名前の数） */
  rowCount: number;
}

/** 読み込み中に並べる Skeleton 行の上限（22 行はさすがに長い） */
const MAX_SKELETON_ROWS = 8;

export interface DirectSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  error: ApiClientError | null;
  results: readonly SearchResult[] | undefined;
  summary: SearchSummary | null;
  registeredNames: ReadonlySet<string>;
  retryingName: string | null;
  /** 希望 TLD はページで 1 つだけ持ち、AI 候補フォームと共有する（#218） */
  tlds: readonly string[];
  onTldsChange: (next: string[]) => void;
  onSearch: (request: DomainCheckRequest, summary: SearchSummary) => void;
  onRegister: (result: SearchResult) => void;
  onShowAlternatives: (names: string[]) => void;
  onRetry: (name: string) => void;
  /** Error Card の「再試行」。直前と同じ条件で check をやり直す */
  onRetrySearch: () => void;
}

export function DirectSearch({
  open,
  onOpenChange,
  busy,
  error,
  results,
  summary,
  registeredNames,
  retryingName,
  tlds,
  onTldsChange,
  onSearch,
  onRegister,
  onShowAlternatives,
  onRetry,
  onRetrySearch,
}: DirectSearchProps) {
  const panelId = useId();
  const messageId = useId();
  const [query, setQuery] = useState("");
  const [invalid, setInvalid] = useState<string | undefined>(undefined);

  const handleTldChange = (next: string[]) => {
    onTldsChange(next);
    if (next.length > 0 && invalid === TLD_REQUIRED) {
      setInvalid(undefined);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseSearchQuery(query);
    if (!parsed.ok) {
      setInvalid(parsed.message);
      return;
    }

    if (parsed.query.kind === "fqdn") {
      setInvalid(undefined);
      onSearch(
        { names: [parsed.query.name] },
        { label: parsed.query.name, tldCount: null, rowCount: 1 },
      );
      return;
    }

    // SLD だけの入力は選択した TLD と掛け合わせる。0 件では check に出せない
    if (tlds.length === 0) {
      setInvalid(TLD_REQUIRED);
      return;
    }
    setInvalid(undefined);
    const picked = [...tlds];
    onSearch(
      { sld: parsed.query.sld, tlds: picked },
      {
        label: parsed.query.sld,
        tldCount: picked.length,
        rowCount: picked.length,
      },
    );
  };

  if (!open) {
    return (
      <button
        aria-controls={panelId}
        aria-expanded={false}
        className="flex h-control-md w-full shrink-0 items-center justify-between gap-2 border-2 border-line border-solid bg-panel px-3 text-body text-ink hover:bg-hover"
        onClick={() => onOpenChange(true)}
        type="button"
      >
        {TRIGGER_LABEL}
        <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
      </button>
    );
  }

  return (
    <div className="flex w-full flex-col gap-3" id={panelId}>
      <Card kicker={TRIGGER_LABEL}>
        <form className="flex w-full flex-col gap-2" onSubmit={handleSubmit}>
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <Input
                aria-describedby={messageId}
                autoComplete="off"
                className={invalid === undefined ? undefined : "border-warn"}
                label="ドメイン名（SLD）"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="takutaku"
                surface="panel"
                value={query}
                {...(invalid === undefined ? {} : { "aria-invalid": true })}
              />
            </div>
            <Button
              leadingIcon={<Search />}
              loading={busy}
              type="submit"
              variant="solid"
            >
              空きを確認
            </Button>
          </div>
          <TldMultiSelect label="TLD" onChange={handleTldChange} value={tlds} />
          <p
            className={cn(
              "w-full text-caption",
              invalid === undefined ? "text-muted" : "text-warn",
            )}
            id={messageId}
            {...(invalid === undefined ? {} : { role: "alert" as const })}
          >
            {invalid ?? HELPER}
          </p>
        </form>
      </Card>

      <SearchResults
        busy={busy}
        error={error}
        onRegister={onRegister}
        onRetry={onRetry}
        onRetrySearch={onRetrySearch}
        onShowAlternatives={onShowAlternatives}
        registeredNames={registeredNames}
        results={results}
        retryingName={retryingName}
        summary={summary}
      />
    </div>
  );
}

interface SearchResultsProps {
  busy: boolean;
  error: ApiClientError | null;
  results: readonly SearchResult[] | undefined;
  summary: SearchSummary | null;
  registeredNames: ReadonlySet<string>;
  retryingName: string | null;
  onRegister: (result: SearchResult) => void;
  onShowAlternatives: (names: string[]) => void;
  onRetry: (name: string) => void;
  onRetrySearch: () => void;
}

/**
 * 独自性スコアは SLD で決まるので、同じ名前を TLD 違いで並べると全行が同じ数字になる。
 * 取得済みでない行のスコアが 1 つに定まるときだけ、見出しにまとめて 1 回だけ出す（#218）。
 * 取れない（スコアなし）ときは null を返し、見出しからスコアごと落とす。
 */
function sharedUniqueness(
  results: readonly SearchResult[],
  registeredNames: ReadonlySet<string>,
): UniquenessScore | null {
  const scores = results
    .filter(
      (result) =>
        !registeredNames.has(result.name) &&
        result.availability !== "unavailable",
    )
    .map((result) => result.uniqueness)
    .filter((uniqueness): uniqueness is UniquenessScore => uniqueness !== null);

  const first = scores[0];
  if (first === undefined) {
    return null;
  }
  return scores.every((score) => score.score === first.score) ? first : null;
}

/** 結果カード（読み込み / エラー / 結果あり）。まだ検索していないときは何も出さない。 */
function SearchResults({
  busy,
  error,
  results,
  summary,
  registeredNames,
  retryingName,
  onRegister,
  onShowAlternatives,
  onRetry,
  onRetrySearch,
}: SearchResultsProps) {
  if (busy && summary !== null) {
    const rows = Array.from(
      { length: Math.min(summary.rowCount, MAX_SKELETON_ROWS) },
      (_, index) => `search-skeleton-${index}`,
    );
    return (
      <Card kicker={`${summary.label} の空き状況を確認しています…`}>
        <ul className="flex w-full flex-col">
          {rows.map((key) => (
            <SearchResultRowSkeleton key={key} />
          ))}
        </ul>
      </Card>
    );
  }

  // 候補側の Error Card と同じく、同じ条件でそのまま送り直せるようにする
  if (error !== null) {
    return <ErrorCard error={error} onRetry={onRetrySearch} showLogsLink />;
  }

  if (results === undefined || summary === null) {
    return null;
  }

  const available = results.filter(
    (r) => r.availability === "available",
  ).length;
  const unavailable = results.filter(
    (r) => r.availability === "unavailable",
  ).length;
  const failed = results.filter((r) => r.availability === "error");
  const counts = [
    available === 0 ? null : `空き ${available}`,
    unavailable === 0 ? null : `取得済み ${unavailable}`,
    failed.length === 0 ? null : `確認不可 ${failed.length}`,
  ]
    .filter((part): part is string => part !== null)
    .join("・");
  const kicker =
    counts === ""
      ? `${summary.label} の空き状況`
      : `${summary.label} の空き状況 — ${counts}`;
  const uniqueness = sharedUniqueness(results, registeredNames);

  return (
    <Card kicker={kicker}>
      {uniqueness === null ? null : (
        <ResultsScore
          sameForEveryTld={summary.tldCount !== null && results.length > 1}
          uniqueness={uniqueness}
        />
      )}
      <ul className="flex w-full flex-col">
        {results.map((result) => (
          <SearchResultRow
            key={result.name}
            onRegister={onRegister}
            onRetry={onRetry}
            onShowAlternatives={onShowAlternatives}
            registered={registeredNames.has(result.name)}
            result={result}
            retrying={retryingName === result.name}
          />
        ))}
      </ul>
      {failed.length === 0 ? null : (
        <p className="w-full text-caption text-muted">
          {[...new Set(failed.map((r) => REGISTRY_LABEL[r.registry]))].join(
            " / ",
          )}{" "}
          が応答しないため {failed.map((r) => `.${r.tld}`).join(" / ")}{" "}
          は確認できませんでした。他の結果はそのまま表示しています
        </p>
      )}
    </Card>
  );
}

interface ResultsScoreProps {
  uniqueness: UniquenessScore;
  /** SLD × TLD の一括確認。どの行も同じ値になることを添える */
  sameForEveryTld: boolean;
}

/** 結果カードの見出しに 1 つだけ出すスコア。押すと似ている名前を開く（#218）。 */
function ResultsScore({ uniqueness, sameForEveryTld }: ResultsScoreProps) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex w-full flex-wrap items-center gap-2">
        <button
          aria-controls={detailsId}
          aria-expanded={open}
          aria-label={open ? "似ている名前を閉じる" : "似ている名前を開く"}
          className="flex shrink-0 items-center gap-1.5"
          onClick={() => setOpen((prev) => !prev)}
          type="button"
        >
          <ScoreGauge
            size="sm"
            tone={gaugeTone(uniqueness)}
            value={uniqueness.score}
          />
          <Rarity tier={rarityTier(uniqueness.score)} />
          <span className="text-caption text-muted">
            {uniquenessText(uniqueness.score)}
          </span>
        </button>
        {sameForEveryTld ? (
          <span className="min-w-0 text-caption text-muted">
            どの TLD でも同じ値です
          </span>
        ) : null}
      </div>
      {open ? (
        <ul className="flex w-full flex-col gap-0.5" id={detailsId}>
          {uniqueness.nearest.map((near) => (
            <li key={near.name}>
              <SimilarityRow name={near.name} similarity={near.similarity} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
