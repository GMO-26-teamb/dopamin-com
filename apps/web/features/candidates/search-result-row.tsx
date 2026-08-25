"use client";

import { ArrowRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScoreGauge } from "@/components/ui/score-gauge";
import { Skeleton } from "@/components/ui/skeleton";
import type { SearchResult } from "@/lib/api/types";
import {
  AvailabilityBadge,
  DomainLabel,
  gaugeTone,
  RarityMark,
} from "./labels";

/**
 * Figma: Search Result Row `78:398` / S-24 `81:1156`
 * 直接検索の 1 行（Available / Taken / Error）。部分失敗（AC-03-2）の行は
 * 「確認不可」+ 当該レジストリのみ再 check する「再試行」を出す。
 */

export interface SearchResultRowProps {
  result: SearchResult;
  /** S-26 を閉じたあと。取得した行は「取得しました → 詳細」に変わる */
  registered?: boolean;
  onRegister: (result: SearchResult) => void;
  onShowAlternatives: (names: string[]) => void;
  onRetry: (name: string) => void;
  retrying?: boolean;
}

/**
 * 読み込み中の行（ui-screens S-24「行ごとに Skeleton + レジストリ名」）。
 * どのレジストリが担当するかは check の応答で初めて分かるので、
 * 未確定のうちはレジストリ名の枠も Skeleton にする。
 */
export function SearchResultRowSkeleton({ registry }: { registry?: string }) {
  return (
    <li className="flex w-full items-center gap-3 border-soft border-b py-3 last:border-b-0">
      <Skeleton className="h-4 max-w-60" />
      {registry === undefined ? (
        <Skeleton className="h-3 w-16 shrink-0" />
      ) : (
        <span className="shrink-0 text-caption text-muted">{registry}</span>
      )}
      <Skeleton className="h-control-sm w-24 shrink-0" shape="block" />
    </li>
  );
}

export function SearchResultRow({
  result,
  registered = false,
  onRegister,
  onShowAlternatives,
  onRetry,
  retrying = false,
}: SearchResultRowProps) {
  const taken = registered || result.availability === "unavailable";
  const { uniqueness } = result;

  return (
    <li className="flex w-full items-center gap-3 border-soft border-b py-3 last:border-b-0">
      <span className="min-w-0 flex-1 truncate">
        <DomainLabel muted={taken} name={result.name} size="sm" />
      </span>
      <span className="shrink-0 text-caption text-muted">
        {result.registry}
      </span>
      {registered ? (
        <Badge tone="muted" variant="solid">
          取得しました
        </Badge>
      ) : (
        <AvailabilityBadge
          availability={result.availability}
          uniqueness={uniqueness}
        />
      )}
      {result.availability === "error" ? (
        <span className="shrink-0 text-caption text-muted">
          一部レジストリが応答なし
        </span>
      ) : null}
      {taken && result.alternatives.length > 0 ? (
        <span className="min-w-0 truncate text-caption text-muted">
          代替: {result.alternatives.join(" / ")}
        </span>
      ) : null}
      {taken || uniqueness === null ? null : (
        <span className="flex shrink-0 items-center gap-1.5">
          <ScoreGauge
            size="sm"
            tone={gaugeTone(uniqueness)}
            value={uniqueness.score}
          />
          <RarityMark
            availability={result.availability}
            uniqueness={uniqueness}
          />
        </span>
      )}
      <RowAction
        onRegister={onRegister}
        onRetry={onRetry}
        onShowAlternatives={onShowAlternatives}
        registered={registered}
        result={result}
        retrying={retrying}
      />
    </li>
  );
}

interface RowActionProps extends Omit<SearchResultRowProps, "registered"> {
  registered: boolean;
  retrying: boolean;
}

function RowAction({
  result,
  registered,
  onRegister,
  onShowAlternatives,
  onRetry,
  retrying,
}: RowActionProps) {
  if (registered) {
    return (
      <Button asChild size="sm" trailingIcon={<ArrowRight />} variant="outline">
        <Link href={`/domains/${result.name}`}>詳細</Link>
      </Button>
    );
  }

  if (result.availability === "error") {
    return (
      <Button
        leadingIcon={<RefreshCw />}
        loading={retrying}
        onClick={() => onRetry(result.name)}
        size="sm"
        variant="outline"
      >
        再試行
      </Button>
    );
  }

  if (result.availability === "unavailable") {
    return (
      <Button
        onClick={() => onShowAlternatives(result.alternatives)}
        size="sm"
        variant="subtle"
      >
        代替を見る
      </Button>
    );
  }

  return (
    <Button
      onClick={() => onRegister(result)}
      size="sm"
      trailingIcon={<ArrowRight />}
      variant={result.uniqueness?.label === "low" ? "subtle" : "solid"}
    >
      {result.uniqueness?.label === "low" ? "それでも登録" : "登録へ"}
    </Button>
  );
}
