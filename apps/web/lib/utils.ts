import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import { TEXT_STYLE_UTILITIES } from "./theme/text-styles";

/** `text-body` → `body` のように、tailwind-merge に渡すサフィックスへ */
const textStyleSuffixes = TEXT_STYLE_UTILITIES.map((utility) =>
  utility.replace(/^text-/, ""),
);

/**
 * 独自の text-* ユーティリティ（Figma Text Style）を tailwind-merge に教える。
 * 同じグループ同士は後勝ちで畳み、後ろに来た text-style は前の
 * font-size / font-weight / font-family / leading / tracking を打ち消す。
 */
const twMerge = extendTailwindMerge<"text-style">({
  extend: {
    classGroups: {
      "text-style": [{ text: textStyleSuffixes }],
    },
    conflictingClassGroups: {
      "text-style": [
        "font-size",
        "font-weight",
        "font-family",
        "leading",
        "tracking",
      ],
    },
  },
});

/** Tailwind のクラスを条件付きで組み立てて、競合するユーティリティを後勝ちで畳む */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
