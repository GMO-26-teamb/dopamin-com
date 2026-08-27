"use client";

import { motion } from "motion/react";
import { Banner } from "@/components/ui/banner";
import { Skeleton } from "@/components/ui/skeleton";
import type { Candidate } from "@/lib/api/types";
import { useReducedMotion } from "@/lib/theme/use-reduced-motion";
import { CandidateCard } from "./candidate-card";

/**
 * ui-screens S-21（生成中 = Skeleton Card ×6）/ S-22（候補 6 件）。
 * カードは `motion` でスタガー表示し、`prefers-reduced-motion` では即座に出す（要件 §15.3）。
 */

/** S-21 で並べる Skeleton の枚数（AI は必ず 6 件返す・FR-04） */
const SKELETON_COUNT = 6;
const SKELETON_KEYS = Array.from(
  { length: SKELETON_COUNT },
  (_, index) => `candidate-skeleton-${index}`,
);

const STAGGER_S = 0.05;
const FADE_S = 0.24;

export interface CandidateGridProps {
  candidates: readonly Candidate[];
  registeredNames: ReadonlySet<string>;
  retryingName: string | null;
  onRegister: (candidate: Candidate) => void;
  onShowAlternatives: (names: string[]) => void;
  onRetry: (name: string) => void;
}

/** S-21: 生成中。Skeleton Card ×6 と「考え中…」の注記。 */
export function CandidateGridSkeleton() {
  return (
    <div className="flex w-full flex-col gap-3">
      <ul className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SKELETON_KEYS.map((key) => (
          <li key={key}>
            <Skeleton className="h-38" shape="card" />
          </li>
        ))}
      </ul>
      <p className="w-full text-caption text-muted" role="status">
        考え中… 空き状況と独自性スコアも一緒に調べます（最大 10 秒）
      </p>
    </div>
  );
}

export function CandidateGrid({
  candidates,
  registeredNames,
  retryingName,
  onRegister,
  onShowAlternatives,
  onRetry,
}: CandidateGridProps) {
  const reduced = useReducedMotion();
  // 6 件すべてが Unknown（両レジストリ停止）のときだけ上部に Banner Warn（ui-screens §2.3）
  const allUnknown =
    candidates.length > 0 &&
    candidates.every((candidate) => candidate.availability === "error");

  return (
    <div className="flex w-full flex-col gap-3">
      {allUnknown ? (
        <Banner
          body="どのレジストリも応答していません。時間をおいて各カードの「再試行」で確認してください。"
          title="空き状況を確認できませんでした"
          tone="warn"
        />
      ) : null}
      <ul className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {candidates.map((candidate, index) => {
          const name = `${candidate.sld}.${candidate.tld}`;
          return (
            <motion.li
              animate={{ opacity: 1, y: 0 }}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              key={name}
              transition={{ duration: FADE_S, delay: index * STAGGER_S }}
            >
              <CandidateCard
                candidate={candidate}
                onRegister={onRegister}
                onRetry={onRetry}
                onShowAlternatives={onShowAlternatives}
                registered={registeredNames.has(name)}
                retrying={retryingName === name}
              />
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}
