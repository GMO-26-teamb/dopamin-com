"use client";

/**
 * 自動承認までの残り時間（ui-screens §4「カウントダウン」/ S-32 / D-06）。
 *
 * `mm:ss` で 1 秒ごとに更新し、0 に到達したら `expired` を立てる。
 * 分は 2 桁以上でゼロ埋めし、60 分を超えても `mm:ss` のまま（例 `75:00`）。
 */

import { useEffect, useState } from "react";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

export interface Countdown {
  /** 残りミリ秒（0 未満にはならない）。 */
  remainingMs: number;
  /** `mm:ss`。対象が無いときは `--:--`。 */
  label: string;
  /** 対象があり、かつ残り 0 になった。 */
  expired: boolean;
}

/** 対象時刻までの残りミリ秒。過去・不正な値は 0。 */
export function remainingMsUntil(target: string | null, now: number): number {
  if (target === null) {
    return 0;
  }
  const at = new Date(target).getTime();
  if (Number.isNaN(at)) {
    return 0;
  }
  return Math.max(0, at - now);
}

/** 残りミリ秒を `mm:ss` にする（切り上げ = 表示上 0 秒の間に操作できてしまうのを防ぐ）。 */
export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.ceil(remainingMs / SECOND_MS);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * `target`（ISO 8601）までの残り時間を 1 秒ごとに更新する。
 * `target` が `null` のときはタイマーを張らない。
 */
export function useCountdown(target: string | null | undefined): Countdown {
  const at = target ?? null;
  const [remainingMs, setRemainingMs] = useState(() =>
    remainingMsUntil(at, Date.now()),
  );

  useEffect(() => {
    if (at === null) {
      setRemainingMs(0);
      return;
    }
    // 依存が変わった直後は次の tick を待たずに合わせる
    setRemainingMs(remainingMsUntil(at, Date.now()));
    const timer = window.setInterval(() => {
      setRemainingMs(remainingMsUntil(at, Date.now()));
    }, SECOND_MS);
    return () => window.clearInterval(timer);
  }, [at]);

  return {
    remainingMs,
    label: at === null ? "--:--" : formatCountdown(remainingMs),
    expired: at !== null && remainingMs <= 0,
  };
}

/** 残り時間が短いか（バナー・ボタンの警告表示に使う）。既定は 5 分。 */
export function isUrgent(remainingMs: number, thresholdMs = 5 * MINUTE_MS) {
  return remainingMs > 0 && remainingMs <= thresholdMs;
}
