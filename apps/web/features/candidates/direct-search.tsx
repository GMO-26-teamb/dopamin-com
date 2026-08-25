"use client";

import type { DomainCheckRequest } from "@dopamin/shared";
import { ChevronDown, Search } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorCard } from "@/components/ui/error-card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ApiClientError } from "@/lib/api/errors";
import type { SearchResult } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { SearchResultRow, SearchResultRowSkeleton } from "./search-result-row";
import { ALL_TLDS, parseSearchQuery, resolveTlds, TLD_OPTIONS } from "./tlds";

/**
 * Figma: S-20 `81:741`（初期）/ S-24 `81:1156`（結果）
 * ui-screens S-24。SLD + TLD 複数選択、または `.` を含む入力を FQDN として 1 件で check する。
 * 部分失敗（AC-03-2）は「確認不可」の行を残したまま、他の結果を表示し続ける。
 */

const HELPER =
  "英数字とハイフン、1〜63 文字（RFC 1035）。IDN は非対応。不正な文字列はレジストリに送りません";
const TRIGGER_LABEL = "自分で入力して探す（TLD 22 種を一括確認）";

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
  onSearch: (request: DomainCheckRequest, summary: SearchSummary) => void;
  onRegister: (result: SearchResult) => void;
  onShowAlternatives: (names: string[]) => void;
  onRetry: (name: string) => void;
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
  onSearch,
  onRegister,
  onShowAlternatives,
  onRetry,
}: DirectSearchProps) {
  const panelId = useId();
  const messageId = useId();
  const [query, setQuery] = useState("");
  const [tld, setTld] = useState<string>(ALL_TLDS);
  const [invalid, setInvalid] = useState<string | undefined>(undefined);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseSearchQuery(query);
    if (!parsed.ok) {
      setInvalid(parsed.message);
      return;
    }
    setInvalid(undefined);

    if (parsed.query.kind === "fqdn") {
      onSearch(
        { names: [parsed.query.name] },
        { label: parsed.query.name, tldCount: null, rowCount: 1 },
      );
      return;
    }

    const tlds = resolveTlds(tld);
    onSearch(
      { sld: parsed.query.sld, tlds },
      { label: parsed.query.sld, tldCount: tlds.length, rowCount: tlds.length },
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
          <div className="flex w-full items-end gap-3">
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
            <div className="w-44 shrink-0">
              <Select
                label="TLD"
                onValueChange={setTld}
                options={TLD_OPTIONS}
                surface="panel"
                value={tld}
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

  if (error !== null) {
    return <ErrorCard error={error} showLogsLink />;
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
  const scope = summary.tldCount === null ? "" : `${summary.tldCount} TLD 中 `;
  const kicker = `${summary.label} の空き状況 — ${scope}${results.length} 件を表示（空き ${available}・取得済み ${unavailable}・確認不可 ${failed.length}）`;

  return (
    <Card kicker={kicker}>
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
          {[...new Set(failed.map((r) => r.registry))].join("・")}{" "}
          が応答しないため {failed.map((r) => `.${r.tld}`).join("・")}{" "}
          は確認できませんでした。他の結果は表示しています（AC-03-2 部分失敗）
        </p>
      )}
    </Card>
  );
}
