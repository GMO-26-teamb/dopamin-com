import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Figma: Logo `43:6` / Sticker `43:9` / Goku `43:15` / Brand Bar `43:18`
 * ブランド要素。グラデーションはテーマ（standard / goku）に追従する。
 */

/**
 * Figma の Logo は 16px 単一サイズなので md がデザイン通り。
 * lg は Heading/Page と同じ 20px/28px に合わせた拡大版（Figma に対応ノードなし）。
 */
const LOGO_SIZE = {
  md: {
    jp: "text-brand-logo",
    latin: "text-brand-logo-latin",
  },
  lg: {
    jp: "font-jp font-black text-xl/7",
    latin: "font-latin font-black text-xl/7",
  },
} as const;

export interface LogoProps {
  size?: "md" | "lg";
  className?: string;
}

export function Logo({ size = "md", className }: LogoProps) {
  const style = LOGO_SIZE[size];

  return (
    <span
      className={cn("inline-flex items-baseline whitespace-nowrap", className)}
    >
      <span className={cn("text-ink", style.jp)}>ドパ民</span>
      <span className={cn("brand-text", style.latin)}>.com</span>
    </span>
  );
}

export interface StickerProps {
  children?: ReactNode;
  className?: string;
}

export function Sticker({
  children = "Z世代のドメイン屋",
  className,
}: StickerProps) {
  return (
    <span
      className={cn(
        "-rotate-2 inline-flex items-center border-[length:var(--stroke-medium)] border-ink px-2 py-0.5 text-ink text-label-xs",
        className,
      )}
    >
      {children}
    </span>
  );
}

export interface GokuProps {
  size?: "md" | "sm";
  className?: string;
}

/** 「極」ディスプレイ文字。色は親から継承する（セグメント選択時に反転するため） */
export function Goku({ size = "md", className }: GokuProps) {
  return (
    <span
      className={cn(
        "-rotate-4 inline-flex items-center justify-center",
        size === "md" ? "text-brand-goku" : "text-brand-goku-sm",
        className,
      )}
    >
      極
    </span>
  );
}

export interface BrandBarProps {
  /** accent = 見出し上・ダイアログ上端の短い帯 / rule = 幅いっぱいの帯 */
  variant?: "accent" | "rule";
  className?: string;
}

export function BrandBar({ variant = "accent", className }: BrandBarProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "brand-gradient",
        variant === "rule" ? "h-2 w-full" : "h-1.5 w-16",
        className,
      )}
    />
  );
}
