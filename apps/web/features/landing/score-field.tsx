import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * S-00 右カラムの余白に敷く抽象の場（#218）。
 *
 * このデザインシステムの原子はグラデーションの罫線（`BrandBar`）で、見出しの上と
 * ページ最下部で既に使っている。ここではその原子だけを増やして場をつくる。
 * 罫線は入力ブロックに近づくほど短くなり、下でまた開く。独自性スコアが測っている
 * のは「名前どうしの近さ」なので、詰まる / ほどける という形そのものが主題の抽象になる。
 *
 * 文字は足さない。読ませるものではないので `aria-hidden`。
 * 動きは `.score-field-row`（globals.css）が持ち、`prefers-reduced-motion` で止まる。
 */

/**
 * 罫線の長さ（%）。入力ブロック側の端ほど短い。
 * 乱数は使わない（SSR とクライアントで同じ絵になるように）。
 */
const TOP_ROWS = [92, 71, 58, 47, 38, 30, 23, 17, 11] as const;
const BOTTOM_ROWS = [10, 15, 22, 31, 43, 57, 73, 91] as const;

/**
 * 濃さ。入力ブロックに近いほど淡くして、上下で対になるようにする。
 * 地に沈める範囲に収め、入力の可読性を邪魔しない。
 */
function rowOpacity(index: number, total: number): number {
  const t = total === 1 ? 0 : index / (total - 1);
  return Number((0.5 - 0.34 * t).toFixed(3));
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
        "hidden min-h-0 flex-1 shrink flex-col justify-between gap-3 overflow-hidden lg:flex",
        placement === "top" ? "pb-8" : "pt-8",
        className,
      )}
    >
      {rows.map((width, index) => {
        // 入力ブロック側の端を淡くする（top は末尾、bottom は先頭が入力側）
        const fade = placement === "top" ? index : rows.length - 1 - index;
        return (
          <span
            className="score-field-row block h-[length:var(--stroke-accent)] shrink-0"
            key={`${placement}-${width}`}
            style={
              {
                width: `${width}%`,
                opacity: rowOpacity(fade, rows.length),
                // 1 本ずつ周期をずらして、ゆっくりした干渉に見せる
                "--row-duration": `${17 + index * 1.6}s`,
                "--row-delay": `${index * -1.7}s`,
              } as CSSProperties
            }
          />
        );
      })}
    </div>
  );
}
