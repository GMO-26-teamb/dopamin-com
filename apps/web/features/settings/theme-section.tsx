"use client";

import { ThemeToggle } from "@/components/app/theme-toggle";
import { Card } from "@/components/ui/card";

/**
 * Figma: S-70 `85:6709`（Card kicker「テーマ」+ Segmented Control Medium）
 * テーマは `ThemeProvider` が localStorage に保存するだけで API を持たない（FR-01 の範囲外）。
 */
const THEME_NOTE =
  "極ドパモード: ダーク地 + RGBアクセント。prefers-reduced-motion時はグラデーションの動きを停止（NFR-08）";

export function ThemeSection() {
  return (
    <Card kicker="テーマ">
      {/* Card の Content は縦並びなので、トグルが横いっぱいに伸びないよう self-start */}
      <ThemeToggle className="self-start" />
      <p className="text-caption-sm text-muted">{THEME_NOTE}</p>
    </Card>
  );
}
