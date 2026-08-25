"use client";

import { ArrowRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScoreGauge } from "@/components/ui/score-gauge";
import { SimilarityRow } from "@/components/ui/similarity-row";
import type { Candidate } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import {
  AvailabilityBadge,
  DomainLabel,
  gaugeTone,
  RarityMark,
} from "./labels";

/**
 * Figma: Candidate Card `58:249`（SSR / R / N / Taken / Unknown の 5 バリアント）
 * ui-screens S-22。ドメイン名 / Rarity / Score Gauge（クリックで類似候補 3 件を開閉）/
 * 理由 / 空きバッジ / 操作。
 */

export interface CandidateCardProps {
  candidate: Candidate;
  /** S-26 を閉じたあと。当該カードは「取得しました → 詳細」に変わる（ui-screens S-26） */
  registered?: boolean;
  /** 「登録へ」→ S-25 */
  onRegister: (candidate: Candidate) => void;
  /** 「代替を確認」→ S-24 に代替候補を出す */
  onShowAlternatives: (names: string[]) => void;
  /** 「再試行」→ 当該候補のみ再 check（AC-05-2） */
  onRetry: (name: string) => void;
  retrying?: boolean;
  className?: string;
}

/** 空き かつ 独自性 high は 1 枚だけ強調する（Figma の SSR バリアント）。 */
function emphasisFor(candidate: Candidate, registered: boolean) {
  if (registered || candidate.availability === "unavailable") {
    return "muted" as const;
  }
  if (
    candidate.availability === "available" &&
    candidate.uniqueness?.label === "high"
  ) {
    return "brand" as const;
  }
  return "default" as const;
}

export function CandidateCard({
  candidate,
  registered = false,
  onRegister,
  onShowAlternatives,
  onRetry,
  retrying = false,
  className,
}: CandidateCardProps) {
  const name = `${candidate.sld}.${candidate.tld}`;
  // Figma の候補カードは類似候補を開いた状態。ゲージで折りたためる（ui-screens S-22）
  const [open, setOpen] = useState(true);
  const similarityId = useId();
  const { uniqueness } = candidate;
  const availability = registered ? "unavailable" : candidate.availability;

  return (
    <Card
      className={cn("h-full justify-between gap-2", className)}
      emphasis={emphasisFor(candidate, registered)}
    >
      <div className="flex w-full items-start justify-between gap-2">
        <DomainLabel muted={availability === "unavailable"} name={name} />
        <RarityMark availability={availability} uniqueness={uniqueness} />
      </div>

      {uniqueness === null ? null : (
        <div className="flex w-full items-center gap-2">
          <button
            aria-controls={similarityId}
            aria-expanded={open}
            aria-label={open ? "類似候補を閉じる" : "類似候補を開く"}
            className="shrink-0"
            onClick={() => setOpen((prev) => !prev)}
            type="button"
          >
            <ScoreGauge
              size="sm"
              tone={gaugeTone(uniqueness)}
              value={uniqueness.score}
            />
          </button>
          {open ? (
            <ul
              className="flex min-w-0 flex-1 flex-col gap-0.5"
              id={similarityId}
            >
              {uniqueness.nearest.map((near) => (
                <li key={near.name}>
                  <SimilarityRow
                    name={near.name}
                    similarity={near.similarity}
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      <div className="flex w-full items-center justify-between gap-2">
        {registered ? (
          <Badge tone="muted" variant="solid">
            取得しました
          </Badge>
        ) : (
          <AvailabilityBadge
            availability={availability}
            uniqueness={uniqueness}
          />
        )}
        <CandidateAction
          candidate={candidate}
          name={name}
          onRegister={onRegister}
          onRetry={onRetry}
          onShowAlternatives={onShowAlternatives}
          registered={registered}
          retrying={retrying}
        />
      </div>

      <p className="w-full text-caption text-muted">
        {candidate.availability === "error"
          ? "空き状況を確認できませんでした。スコアは表示できます"
          : candidate.reason}
      </p>
    </Card>
  );
}

interface CandidateActionProps extends Omit<CandidateCardProps, "className"> {
  name: string;
  registered: boolean;
  retrying: boolean;
}

function CandidateAction({
  candidate,
  name,
  registered,
  onRegister,
  onShowAlternatives,
  onRetry,
  retrying,
}: CandidateActionProps) {
  if (registered) {
    return (
      <Button asChild size="sm" trailingIcon={<ArrowRight />} variant="outline">
        <Link href={`/domains/${name}`}>詳細</Link>
      </Button>
    );
  }

  if (candidate.availability === "error") {
    return (
      <Button
        leadingIcon={<RefreshCw />}
        loading={retrying}
        onClick={() => onRetry(name)}
        size="sm"
        variant="outline"
      >
        再試行
      </Button>
    );
  }

  if (candidate.availability === "unavailable") {
    return (
      <Button
        onClick={() => onShowAlternatives(candidate.alternatives)}
        size="sm"
        variant="subtle"
      >
        代替を確認
      </Button>
    );
  }

  // 独自性 low は「それでも登録」（Subtle）に落とす（ui-screens §2.3 の N）
  if (candidate.uniqueness?.label === "low") {
    return (
      <Button onClick={() => onRegister(candidate)} size="sm" variant="subtle">
        それでも登録
      </Button>
    );
  }

  return (
    <Button
      onClick={() => onRegister(candidate)}
      size="sm"
      trailingIcon={<ArrowRight />}
      variant={candidate.uniqueness?.label === "high" ? "solid" : "outline"}
    >
      登録へ
    </Button>
  );
}
