/**
 * lib/theme/tokens.json（Figma 書き出し）から app/tokens.css を生成する。
 *
 *   pnpm --filter @dopamin/web tokens
 *
 * 出力は決定的（同じ入力なら常に同じバイト列）。生成物はコミットする。
 * トークンを変えるときは Figma → tokens.json 再書き出し → 本スクリプト、の順で行う。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ThemeName = "standard" | "goku";

export interface ColorToken {
  /** CSS カスタムプロパティ名（Figma の code syntax と一致させる） */
  css: string;
  standard: string;
  goku: string;
}

export interface TextStyle {
  name: string;
  utility: string;
  font: "jp" | "latin" | "goku" | "mono";
  weight: number;
  size: number;
  lineHeight: number;
  letterSpacing: number;
}

export interface GlowLayer {
  radius: number;
  /** 参照する色トークンのカスタムプロパティ名 */
  color: string;
}

export interface TokensFile {
  color: Record<string, ColorToken>;
  dimensions: Record<string, number>;
  opacity: Record<string, number>;
  fonts: Record<string, string>;
  textStyles: TextStyle[];
  glow: GlowLayer[];
}

/** 総称ファミリのフォールバック（tokens.json は実ファミリ名しか持たないため、ここで補う） */
const GENERIC_FALLBACK: Record<string, string> = {
  "--font-jp": "sans-serif",
  "--font-latin": "sans-serif",
  "--font-goku": "serif",
  "--font-mono": "monospace",
};

const HEADER = `/*
 * GENERATED — edit lib/theme/tokens.json
 * このファイルは手で編集しない。Figma からトークンを書き出して
 * \`pnpm --filter @dopamin/web tokens\` を実行し、生成物ごとコミットする。
 * source: lib/theme/tokens.json / generator: scripts/gen-tokens.ts
 */`;

/** "Noto Sans JP" -> "noto-sans-jp"（next/font の variable 名に使う） */
export function fontSlug(family: string): string {
  return family
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** css 名で重複を畳む（Figma は bg/text/border で同じ変数を共有している） */
export function uniqueColors(color: TokensFile["color"]): ColorToken[] {
  const byCss = new Map<string, ColorToken>();
  for (const [figmaName, token] of Object.entries(color)) {
    const seen = byCss.get(token.css);
    if (seen === undefined) {
      byCss.set(token.css, token);
      continue;
    }
    if (seen.standard !== token.standard || seen.goku !== token.goku) {
      throw new Error(
        `tokens.json: ${token.css} が矛盾した値を持っています（${figmaName}）。Figma の変数を確認してください。`,
      );
    }
  }
  return [...byCss.values()];
}

/** 16px = 1rem。`html` の font-size を画面幅で段階的に上げると全体が追従する */
const REM_BASE_PX = 16;

/** 数値を rem 文字列にする（末尾の 0 を落として決定的に） */
export function rem(px: number): string {
  const value = Number((px / REM_BASE_PX).toFixed(4));
  return value === 0 ? "0" : `${value}rem`;
}

/** 線幅（--stroke-*）と角丸は px のまま。それ以外の寸法は rem */
export function dimension(name: string, px: number): string {
  if (name.startsWith("--stroke-") || name.startsWith("--radius-")) {
    return `${px}px`;
  }
  return rem(px);
}

/**
 * 大画面での基準サイズ。Tailwind の rem スペーシングと text-* ユーティリティ（rem）が
 * まとめて追従するので、これだけで「大きな画面ではひとまわり大きく」が効く。
 */
const HTML_SCALE_STEPS: readonly [
  minWidthPx: number,
  fontSizePercent: number,
][] = [
  [1536, 106.25],
  [1920, 112.5],
];

function block(selector: string, lines: string[]): string {
  // 区切りの空行に末尾スペースを残さない（Biome の format と生成物を一致させる）
  const body = lines.map((line) => (line === "" ? "" : `  ${line}`)).join("\n");
  return `${selector} {\n${body}\n}`;
}

export function generateTokensCss(tokens: TokensFile): string {
  const colors = uniqueColors(tokens.color);

  // data-theme 属性が無い / 消えたときの保険。属性セレクタの方が詳細度が高いので純粋に追加。
  const fallbackBlock = block(":root", [
    "/* data-theme が付いていないときは標準モードで描画する（保険） */",
    ...colors.map((token) => `${token.css}: ${token.standard};`),
  ]);

  const themeBlocks = (["standard", "goku"] satisfies ThemeName[]).map(
    (theme) =>
      block(
        `:root[data-theme="${theme}"]`,
        colors.map((token) => `${token.css}: ${token[theme]};`),
      ),
  );

  const rootLines: string[] = [
    "/* dimensions（Figma の px 値を rem 化。線幅だけは px のまま） */",
  ];
  for (const [name, value] of Object.entries(tokens.dimensions)) {
    rootLines.push(`${name}: ${dimension(name, value)};`);
  }

  rootLines.push("", "/* opacity */");
  for (const [name, value] of Object.entries(tokens.opacity)) {
    rootLines.push(`${name}: ${value};`);
  }

  rootLines.push(
    "",
    "/* fonts（var(--font-*) は app/layout.tsx の next/font が注入する） */",
  );
  for (const [name, family] of Object.entries(tokens.fonts)) {
    const fallback = GENERIC_FALLBACK[name] ?? "sans-serif";
    rootLines.push(
      `${name}: var(--font-${fontSlug(family)}), "${family}", ${fallback};`,
    );
  }

  const glow = tokens.glow
    .map((layer) => `0 0 ${layer.radius}px var(${layer.color})`)
    .join(", ");
  const glowHover = tokens.glow
    .map((layer) => `0 0 ${layer.radius * 1.5}px var(${layer.color})`)
    .join(", ");
  rootLines.push(
    "",
    "/* brand（テーマごとの色を参照するので :root に置いても両テーマで正しく解決する） */",
    // Biome の CSS formatter（1 行 80 桁）が折り返す形で最初から書き出す
    "--gradient-brand: linear-gradient(",
    "  90deg,",
    "  var(--color-brand-1),",
    "  var(--color-brand-mid),",
    "  var(--color-brand-2)",
    ");",
    `--glow-brand: ${glow};`,
    "/* hover 時は半径を 1.5 倍に広げる（Primary ボタン） */",
    `--glow-brand-hover: ${glowHover};`,
    "",
    "/* brand-gradient の動き。標準は静止、極ドパは下のブロックで上書きする */",
    "--gradient-size: 100% 100%;",
    "--gradient-motion: none;",
  );

  // 極ドパ: ブランド 3 色の間にゲーミング RGB の色相を挟み、末尾を先頭色に戻して継ぎ目なく流す
  const gokuBrand = block(':root[data-theme="goku"]', [
    "--gradient-brand: linear-gradient(",
    "  90deg,",
    "  var(--color-brand-1) 0%,",
    "  var(--color-brand-mid) 18%,",
    "  var(--color-brand-2) 36%,",
    "  #3dff8f 52%,",
    "  #ffe14d 68%,",
    "  #ff7a3d 84%,",
    "  var(--color-brand-1) 100%",
    ");",
    "--gradient-size: 300% 100%;",
    "--gradient-motion: gradient-pan 5s linear infinite;",
  ]);

  const htmlScale = HTML_SCALE_STEPS.map(([minWidth, percent]) =>
    [
      `@media (min-width: ${minWidth}px) {`,
      "  html {",
      `    font-size: ${percent}%;`,
      "  }",
      "}",
    ].join("\n"),
  ).join("\n\n");

  const motion = [
    "@keyframes gradient-pan {",
    "  from {",
    "    background-position: 0% 50%;",
    "  }",
    "  to {",
    "    background-position: 300% 50%;",
    "  }",
    "}",
    "",
    "/*",
    " * ブランドグラデーション面。`bg-[image:var(--gradient-brand)]` の代わりにこれを使う。",
    " * 極ドパモードでは --gradient-motion が動き、動きを減らす設定では止まる（要件 §15.3）。",
    " */",
    block(".brand-gradient", [
      "background-image: var(--gradient-brand);",
      "background-size: var(--gradient-size);",
      "animation: var(--gradient-motion);",
    ]),
    "",
    block(".brand-text", [
      "background-image: var(--gradient-brand);",
      "background-size: var(--gradient-size);",
      "-webkit-background-clip: text;",
      "background-clip: text;",
      "color: transparent;",
      "animation: var(--gradient-motion);",
    ]),
    "",
    "@media (prefers-reduced-motion: reduce) {",
    "  .brand-gradient,",
    "  .brand-text {",
    "    animation: none;",
    "  }",
    "}",
  ].join("\n");

  return `${[HEADER, fallbackBlock, ...themeBlocks, block(":root", rootLines), gokuBrand, htmlScale, motion].join("\n\n")}\n`;
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const input = resolve(here, "../lib/theme/tokens.json");
  const output = resolve(here, "../app/tokens.css");
  const tokens = JSON.parse(readFileSync(input, "utf8")) as TokensFile;
  writeFileSync(output, generateTokensCss(tokens), "utf8");
  process.stdout.write(`generated ${output}\n`);
}

// vitest から import されたときは走らせない
if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  main();
}
