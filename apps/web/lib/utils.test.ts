import { describe, expect, it } from "vitest";
import { TEXT_STYLE_UTILITIES } from "./theme/text-styles";
import tokens from "./theme/tokens.json";
import { cn } from "./utils";

describe("cn", () => {
  it("clsx と同様に条件付きクラスを結合する", () => {
    expect(cn("a", { b: true, c: false }, ["d"])).toBe("a b d");
  });

  it("標準の競合ユーティリティは後勝ちで畳む", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
    expect(cn("bg-panel", "bg-bg")).toBe("bg-bg");
  });

  it("独自 text-* スタイル同士は後勝ちで畳む", () => {
    expect(cn("text-body", "text-heading-page")).toBe("text-heading-page");
    expect(cn("text-label-sm", "text-label")).toBe("text-label");
  });

  it("後ろの text-* スタイルは前の font-size / weight / leading を打ち消す", () => {
    expect(cn("text-sm font-bold leading-6", "text-body")).toBe("text-body");
  });

  it("text-* スタイルの後ろに置いた個別指定は生き残る", () => {
    expect(cn("text-body", "font-bold")).toBe("text-body font-bold");
  });

  it("色の text-* は text-style と競合しない", () => {
    expect(cn("text-muted", "text-body")).toBe("text-muted text-body");
    expect(cn("text-body", "text-ink")).toBe("text-body text-ink");
  });
});

describe("TEXT_STYLE_UTILITIES", () => {
  it("tokens.json の textStyles と 1:1 で一致する", () => {
    const fromTokens = tokens.textStyles.map((style) => style.utility);
    expect([...TEXT_STYLE_UTILITIES]).toEqual(fromTokens);
  });
});
