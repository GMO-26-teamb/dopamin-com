"use client";

import { Goku } from "@/components/ui/brand";
import {
  SegmentedControl,
  type SegmentedControlOption,
} from "@/components/ui/segmented-control";
import { type Theme, useTheme } from "@/lib/theme/theme-provider";

/**
 * Figma: Segmented Control `47:41`（サイドバー下部は Small）
 * スタンダード / 極ドパモードの 2 択。値は `ThemeProvider` が localStorage に保存する。
 */
export interface ThemeToggleProps {
  size?: "md" | "sm";
  className?: string;
}

export function ThemeToggle({ size = "md", className }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();

  const options: readonly [
    SegmentedControlOption<Theme>,
    SegmentedControlOption<Theme>,
  ] = [
    { value: "standard", label: "スタンダード" },
    {
      value: "goku",
      label: (
        <>
          <Goku size={size} />
          ドパモード
        </>
      ),
    },
  ];

  return (
    <SegmentedControl
      aria-label="テーマ"
      className={className}
      onChange={setTheme}
      options={options}
      size={size}
      value={theme}
    />
  );
}
