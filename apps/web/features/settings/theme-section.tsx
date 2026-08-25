"use client";

import { ThemeToggle } from "@/components/app/theme-toggle";
import { Card } from "@/components/ui/card";

/**
 * Figma: S-70 `85:6709`（Card kicker「テーマ」+ Segmented Control Medium）
 * テーマは `ThemeProvider` が localStorage に保存するだけで API を持たない（FR-01 の範囲外）。
 */
const THEME_NOTE =
  "極ドパモードは見た目だけが変わります（ダーク地 + 流れる RGB アクセント）。OS で「視差効果を減らす」をオンにしていると、動きは止まります。";

export function ThemeSection() {
  return (
    <Card kicker="テーマ">
      {/* Card の Content は縦並びなので、トグルが横いっぱいに伸びないよう self-start */}
      <ThemeToggle className="self-start" />
      <p className="text-caption-sm text-muted">{THEME_NOTE}</p>
    </Card>
  );
}
