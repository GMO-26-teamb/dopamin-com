import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * S-00 右カラムの余白に敷く抽象の場（#218）。
 *
 * このデザインシステムの原子はグラデーションの罫線（`BrandBar`）で、見出しの上と
 * ページ最下部で既に使っている。ここではその原子を場に広げる。
 *
 * 罫線はすべて同じ位置（継ぎ目）で切ってあり、右側だけがゆっくり横にずれる。
 * 揃っていれば 1 本に見え、ずれれば 2 本に割れる —— 独自性スコアが測っているのは
 * 「名前どうしの近さ」なので、重なって見分けがつかない / ずれて見分けがつく
 * という形そのものが主題の抽象になる。
 *
 * 色を持つのは最上段の 1 本だけにする。入力欄のフォーカス表示が
 * `border-image: var(--gradient-brand)`（`components/ui/input.tsx`）そのものなので、
 * 入力の近くに同じ絵の具を並べるとフォーカスが埋もれる。
 *
 * 文字は足さない。読ませるものではないので `aria-hidden`。
 * 動きは `.score-field-seam`（globals.css）が持ち、`prefers-reduced-motion` で止まる。
 */

/** 継ぎ目の位置（カラム幅に対する %）。全段で共通なので 1 本の縦の線として読める。 */
const SEAM = 38;

/**
 * 罫線の長さ（カラム幅に対する %）。入力ブロック側の端ほど短い。
 * 乱数は使わない（SSR とクライアントで同じ絵になるように）。
 */
const TOP_ROWS = [92, 74, 58, 41, 26] as const;
const BOTTOM_ROWS = [22, 38, 55, 73, 90] as const;

/** 静かな罫線の濃さ。入力に近いほど淡くして、地に沈める。 */
function quietOpacity(step: number, total: number): number {
  const t = total <= 1 ? 0 : step / (total - 1);
  return Number((0.3 - 0.2 * t).toFixed(3));
}

export interface ScoreFieldProps {
  /** top = 入力ブロックの上（下端が入力側）/ bottom = 下 */
  placement: "top" | "bottom";
  className?: string;
}

export function ScoreField({ placement, className }: ScoreFieldProps) {
  const rows = placement === "top" ? TOP_ROWS : BOTTOM_ROWS;

  return (
    <div
      aria-hidden="true"
      className={cn(
        // 余白が足りなければ縮んで消える。lg 未満（1 カラム）では出さない
        "hidden max-h-80 min-h-0 flex-1 shrink select-none flex-col justify-between gap-8 overflow-hidden lg:flex",
        placement === "top" ? "pb-10" : "pt-10",
        className,
      )}
    >
      {rows.map((width, index) => {
        // 入力ブロック側の端ほど淡くする（top は末尾、bottom は先頭が入力側）
        const step = placement === "top" ? index : rows.length - 1 - index;
        // 色を持つのは右カラム全体で 1 本だけ（入力から最も遠い上端）
        const brand = placement === "top" && index === 0;
        const rightWidth = Math.max(0, width - SEAM);
        const segment = cn(
          "block shrink-0",
          brand
            ? "score-field-brand h-[length:var(--stroke-accent)]"
            : "h-[length:var(--stroke-strong)] bg-line",
        );
        const dim = brand ? undefined : quietOpacity(step, rows.length);

        return (
          <div
            className="flex w-full shrink-0 items-center"
            key={`${placement}-${width}`}
            style={
              { ["--seam-delay" as string]: `${step * -2.2}s` } as CSSProperties
            }
          >
            <span
              className={segment}
              style={{ width: `${Math.min(width, SEAM)}%`, opacity: dim }}
            />
            {rightWidth === 0 ? null : (
              <span
                className={cn(segment, "score-field-seam")}
                style={{ width: `${rightWidth}%`, opacity: dim }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
