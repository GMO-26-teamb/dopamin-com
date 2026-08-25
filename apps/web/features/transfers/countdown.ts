"use client";

/**
 * 自動承認までの残り時間（ui-screens §4「カウントダウン」/ §6「数値表示」）。
 *
 * 表示は `mm:ss` を基本にし、1 時間以上残っている場合だけ `h:mm:ss` に伸ばす
 * （モックの基準時刻 `MOCK_NOW` と実時刻がずれても `1234:56` のような表示にしないため）。
 * 0 到達で操作を Disabled にするので、残り 0 は `null` ではなく 0 を返す。
 */

import { useEffect, useState } from "react";

const SECOND_MS = 1000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 残りミリ秒を `mm:ss`（1 時間以上なら `h:mm:ss`）にする。負値は `00:00`。 */
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.floor(remainingMs / SECOND_MS));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * `actByAt`（ISO 文字列）までの残りミリ秒を 1 秒ごとに返す。
 *
 * サーバー描画と初回ハイドレーションでは `Date.now()` を読まない（時刻差で
 * マークアップがずれるため）。読めるまでは `null` を返し、呼び出し側は
 * 残り時間なしの文言にフォールバックする。
 */
export function useCountdown(target: string | null): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (target === null) {
      setNow(null);
      return;
    }
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), SECOND_MS);
    return () => clearInterval(id);
  }, [target]);

  if (target === null || now === null) {
    return null;
  }
  const remaining = new Date(target).getTime() - now;
  return Number.isNaN(remaining) ? null : Math.max(0, remaining);
}
