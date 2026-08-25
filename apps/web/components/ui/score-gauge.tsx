"use client";

import { animate as animateValue } from "motion/react";
import { useEffect, useId, useState } from "react";
import { useReducedMotion } from "@/lib/theme/use-reduced-motion";
import { cn } from "@/lib/utils";
import { clampPercent } from "./progress-bar";

/**
 * Figma: Score Gauge `48:40`
 * 独自性スコアの半円ゲージ。Tone（Brand / Warn）× Size（Large 104×60 / Small 66×38）。
 * 数値は motion でカウントアップし、`useReducedMotion` が true なら即時に確定値を出す。
 */

/** viewBox 104×60 の中で、中心 (52,52)・半径 46・線幅 12 の半円を描く */
const ARC_PATH = "M 6 52 A 46 46 0 0 1 98 52";
const ARC_RADIUS = 46;
const ARC_WIDTH = 12;
const ARC_LENGTH = Math.PI * ARC_RADIUS;
const COUNT_UP_DURATION_S = 0.6;

const SIZE = {
  lg: { box: "h-15 w-26", value: "text-display-score", offset: "bottom-1" },
  sm: {
    box: "h-9.5 w-16.5",
    value: "text-display-score-sm",
    offset: "bottom-0.5",
  },
} as const;

export interface ScoreGaugeProps {
  /** 0〜100 */
  value: number;
  tone?: "brand" | "warn";
  size?: "lg" | "sm";
  /** false でカウントアップを止める（一覧に大量に並べるときなど） */
  animate?: boolean;
  className?: string;
}

export function ScoreGauge({
  value,
  tone = "brand",
  size = "lg",
  animate = true,
  className,
}: ScoreGaugeProps) {
  const target = clampPercent(value);
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(() => (animate ? 0 : target));
  // SVG の url(#id) に入れるので、React の useId が付ける記号を落とす
  const rawId = useId();
  const gradientId = `score-gauge-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  useEffect(() => {
    if (!animate || reduced) {
      setShown(target);
      return;
    }

    const controls = animateValue(0, target, {
      duration: COUNT_UP_DURATION_S,
      ease: "easeOut",
      onUpdate: (current) => setShown(current),
    });
    return () => controls.stop();
  }, [animate, reduced, target]);

  const style = SIZE[size];

  return (
    <div className={cn("relative shrink-0", style.box, className)}>
      <svg
        aria-hidden="true"
        className="absolute inset-0 size-full"
        viewBox="0 0 104 60"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="var(--color-brand-1)" />
            <stop offset="50%" stopColor="var(--color-brand-mid)" />
            <stop offset="100%" stopColor="var(--color-brand-2)" />
          </linearGradient>
        </defs>
        <path
          d={ARC_PATH}
          fill="none"
          stroke="var(--color-track)"
          strokeWidth={ARC_WIDTH}
        />
        <path
          d={ARC_PATH}
          fill="none"
          stroke={tone === "warn" ? "var(--color-warn)" : `url(#${gradientId})`}
          strokeDasharray={ARC_LENGTH}
          strokeDashoffset={ARC_LENGTH * (1 - shown / 100)}
          strokeWidth={ARC_WIDTH}
        />
      </svg>
      <span
        className={cn(
          "absolute inset-x-0 text-center text-ink",
          style.offset,
          style.value,
        )}
      >
        {Math.round(shown)}
      </span>
    </div>
  );
}
