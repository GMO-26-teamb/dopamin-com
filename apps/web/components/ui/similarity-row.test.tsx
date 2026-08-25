import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SimilarityRow } from "./similarity-row";

describe("SimilarityRow", () => {
  it("0〜1 の類似度を小数 2 桁で出す（ui-design 14-domains-new の「takaku 0.61」）", () => {
    render(<SimilarityRow name="takaku.com" similarity={0.61} />);

    expect(screen.getByText("takaku.com")).toBeInTheDocument();
    expect(screen.getByText("0.61")).toBeInTheDocument();
  });

  it("バーの幅は 0〜1 を百分率に直した値", () => {
    const { container } = render(
      <SimilarityRow name="takaku.com" similarity={0.61} />,
    );

    const bar = container.querySelector("span > span.block");
    expect(bar).toHaveStyle({ width: "61%" });
  });

  it("0.8 以上は warn、それ未満は muted", () => {
    const { container, rerender } = render(
      <SimilarityRow name="tiktok.site" similarity={0.88} />,
    );
    expect(screen.getByText("tiktok.site")).toHaveClass("text-warn");
    expect(container.querySelector("span.block")).toHaveClass("bg-warn");

    rerender(<SimilarityRow name="tkt.site" similarity={0.44} />);
    expect(screen.getByText("tkt.site")).toHaveClass("text-ink");
  });

  it("0〜1 の外・NaN は丸める", () => {
    const { rerender } = render(<SimilarityRow name="a" similarity={1.4} />);
    expect(screen.getByText("1.00")).toBeInTheDocument();

    rerender(<SimilarityRow name="a" similarity={-0.2} />);
    expect(screen.getByText("0.00")).toBeInTheDocument();

    rerender(<SimilarityRow name="a" similarity={Number.NaN} />);
    expect(screen.getByText("0.00")).toBeInTheDocument();
  });
});
