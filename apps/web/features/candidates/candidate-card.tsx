"use client";

import { ArrowRight, ChevronDown, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
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
 * ui-screens S-22。ドメイン名 / Rarity / Score Gauge / 似ている名前 3 件 /
 * 理由 / 空きバッジ / 操作。
 *
 * カードの主操作は「登録へ」。ゲージ自体は押せる要素にせず、開閉は隣の小さな
 * トグルに持たせて、いちばん大きい当たり判定を主操作に残す（#218）。
 */

export interface CandidateCardProps {
  candidate: Candidate;
  /** S-26 を閉じたあと。当該カードは「取得しました → 詳細」に変わる（ui-screens S-26） */
  registered?: boolean;
  /** 「登録へ」→ S-25 */
  onRegister: (candidate: Candidate) => void;
  /** 「代替を見る」→ S-24 に代替候補を出す */
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
  // Figma の候補カードは似ている名前を開いた状態。トグルで折りたためる（ui-screens S-22）
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
        <span className="inline-flex items-center gap-1">
          <RarityMark availability={availability} uniqueness={uniqueness} />
          <HelpTip
            content="独自性スコアは、既存のドメインと紛らわしくないほど高くなります（0〜100）。"
            label="独自性スコアとは"
          />
        </span>
      </div>

      {uniqueness === null ? null : (
        <div className="flex w-full flex-col gap-1">
          <div className="flex w-full items-center gap-2">
            <ScoreGauge
              size="sm"
              tone={gaugeTone(uniqueness)}
              value={uniqueness.score}
            />
            <button
              aria-controls={similarityId}
              aria-expanded={open}
              className="flex shrink-0 items-center gap-1 text-caption text-muted transition-colors hover:text-ink"
              onClick={() => setOpen((prev) => !prev)}
              type="button"
            >
              似ている名前
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "size-4 shrink-0 transition-transform motion-reduce:transition-none",
                  open && "rotate-180",
                )}
              />
            </button>
          </div>
          {open ? (
            <ul className="flex w-full flex-col gap-0.5" id={similarityId}>
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
      <Button asChild trailingIcon={<ArrowRight />} variant="outline">
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
        variant="subtle"
      >
        代替を見る
      </Button>
    );
  }

  // 独自性 low は「それでも登録」（Subtle）に落とす（ui-screens §2.3 の N）
  if (candidate.uniqueness?.label === "low") {
    return (
      <Button onClick={() => onRegister(candidate)} variant="subtle">
        それでも登録
      </Button>
    );
  }

  return (
    <Button
      onClick={() => onRegister(candidate)}
      trailingIcon={<ArrowRight />}
      variant={candidate.uniqueness?.label === "high" ? "solid" : "outline"}
    >
      登録へ
    </Button>
  );
}
