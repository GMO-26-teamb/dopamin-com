"use client";

/**
 * 自動承認までの残り時間（ui-screens §4「カウントダウン」/ S-32 / D-06 / S-51）。
 *
 * 表示は `mm:ss` で 1 秒ごとに更新し、0 到達で `expired` を立てる（呼び出し側は
 * 操作を Disabled にして再照会する）。60 分を超えても `mm:ss` のまま（例 `75:00`）＝
 * 仕様どおり時間桁には繰り上げない。
 *
 * サーバー描画と初回レンダーでは `Date.now()` を読まない。時刻差でマークアップが
 * ずれる（ハイドレーション不一致）ため、マウント後の effect で初めて計測し、
 * それまでは `remainingMs: null` /`label: "--:--"` を返す。呼び出し側は残り時間なしの
 * 文言にフォールバックする。
 *
 * ドメイン詳細（P4）と移管一覧（P6）で二重に実装されていたものを 1 つに統合した。
 */

import { useEffect, useState } from "react";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

export interface Countdown {
  /** 残りミリ秒（0 未満にはならない）。対象が無い / 未計測なら `null`。 */
  remainingMs: number | null;
  /** `mm:ss`。対象が無い / 未計測なら `--:--`。 */
  label: string;
  /** 対象があり、かつ残り 0 になった。 */
  expired: boolean;
}

/** 対象時刻までの残りミリ秒。過去・不正な値は 0、対象なしは `null`。 */
export function remainingMsUntil(
  target: string | null,
  now: number,
): number | null {
  if (target === null) {
    return null;
  }
  const at = new Date(target).getTime();
  if (Number.isNaN(at)) {
    return null;
  }
  return Math.max(0, at - now);
}

/** 残りミリ秒を `mm:ss` にする（切り上げ = 表示上 0 秒の間に操作できてしまうのを防ぐ）。 */
export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.ceil(Math.max(0, remainingMs) / SECOND_MS);
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
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    if (at === null) {
      setRemainingMs(null);
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
    label: remainingMs === null ? "--:--" : formatCountdown(remainingMs),
    expired: remainingMs !== null && remainingMs <= 0,
  };
}

/** 残り時間が短いか（バナー・ボタンの警告表示に使う）。既定は 5 分。 */
export function isUrgent(
  remainingMs: number | null,
  thresholdMs = 5 * MINUTE_MS,
): boolean {
  return remainingMs !== null && remainingMs > 0 && remainingMs <= thresholdMs;
}
