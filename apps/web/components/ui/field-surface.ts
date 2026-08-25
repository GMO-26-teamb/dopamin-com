/**
 * 入力系コントロールの面の塗り分け（Figma: Input `46:110` の Surface）。
 * prop は「そのコントロールが**置かれている**面」を指す。bg の上なら panel 色、
 * panel の上なら bg 色で塗ることで、必ず 1 段のコントラストが付く。
 * Input と Select で値がズレないよう 1 か所にまとめている。
 */
export const FIELD_SURFACE = {
  bg: "bg-panel",
  panel: "bg-bg",
} as const;

export type FieldSurface = keyof typeof FIELD_SURFACE;
