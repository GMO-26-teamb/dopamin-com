import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  fontSlug,
  generateTokensCss,
  type TextStyle,
  type TokensFile,
  uniqueColors,
} from "./gen-tokens";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const tokens = JSON.parse(read("../lib/theme/tokens.json")) as TokensFile;
const tokensCss = read("../app/tokens.css");
const globalsCss = read("../app/globals.css");

const FONT_VAR: Record<TextStyle["font"], string> = {
  jp: "--font-jp",
  latin: "--font-latin",
  goku: "--font-goku",
  mono: "--font-mono",
};

function utilityBlock(style: TextStyle): string {
  const letterSpacing =
    style.letterSpacing === 0 ? "0" : `${style.letterSpacing}px`;
  return [
    `@utility ${style.utility} {`,
    `  font-family: var(${FONT_VAR[style.font]});`,
    `  font-weight: ${style.weight};`,
    `  font-size: ${style.size}px;`,
    `  line-height: ${style.lineHeight}px;`,
    `  letter-spacing: ${letterSpacing};`,
    "}",
  ].join("\n");
}

describe("gen-tokens", () => {
  it("コミット済みの app/tokens.css が tokens.json から再生成した内容と一致する", () => {
    expect(generateTokensCss(tokens)).toBe(tokensCss);
  });

  it("同じ入力なら同じ出力（決定的）", () => {
    expect(generateTokensCss(tokens)).toBe(generateTokensCss(tokens));
  });

  it("Figma の重複した色変数を畳んでも値が矛盾しない", () => {
    const colors = uniqueColors(tokens.color);
    expect(colors.map((c) => c.css)).toEqual([
      ...new Set(colors.map((c) => c.css)),
    ]);
    expect(colors.length).toBeGreaterThan(0);
  });

  it("次の font 変数名を tokens.css が参照する（app/layout.tsx の next/font と対応）", () => {
    for (const family of Object.values(tokens.fonts)) {
      expect(tokensCss).toContain(`var(--font-${fontSlug(family)})`);
    }
  });

  it("矛盾した色トークンがあれば投げる", () => {
    expect(() =>
      uniqueColors({
        a: { css: "--color-bg", standard: "#fff", goku: "#000" },
        b: { css: "--color-bg", standard: "#eee", goku: "#000" },
      }),
    ).toThrow(/--color-bg/);
  });
});

describe("globals.css のテキストユーティリティ", () => {
  it("tokens.json の textStyles と 1:1 で一致する", () => {
    for (const style of tokens.textStyles) {
      expect(globalsCss, `${style.name} (${style.utility})`).toContain(
        utilityBlock(style),
      );
    }
  });

  it("余計な @utility を増やしていない", () => {
    const defined = [...globalsCss.matchAll(/^@utility ([\w-]+) \{$/gm)].map(
      (match) => match[1],
    );
    expect(defined).toEqual(tokens.textStyles.map((style) => style.utility));
  });

  it("色トークンをすべて Tailwind の色名に写している", () => {
    const colorNames = uniqueColors(tokens.color)
      .map((token) => token.css)
      .filter((name) => name.startsWith("--color-"));
    for (const name of colorNames) {
      expect(globalsCss).toContain(`  ${name}: var(${name});`);
    }
  });
});
