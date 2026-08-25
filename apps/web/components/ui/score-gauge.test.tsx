import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScoreGauge } from "./score-gauge";

describe("ScoreGauge", () => {
  it("animate=false なら最初から確定値を出す", () => {
    render(<ScoreGauge animate={false} value={82} />);

    expect(screen.getByText("82")).toBeInTheDocument();
  });

  it("カウントアップは最終的に確定値へ着地する", async () => {
    render(<ScoreGauge value={82} />);

    await waitFor(() => {
      expect(screen.getByText("82")).toBeInTheDocument();
    });
  });

  it("0〜100 の外は丸める", () => {
    const { rerender } = render(<ScoreGauge animate={false} value={140} />);
    expect(screen.getByText("100")).toBeInTheDocument();

    rerender(<ScoreGauge animate={false} value={-20} />);
    expect(screen.getByText("0")).toBeInTheDocument();

    rerender(<ScoreGauge animate={false} value={Number.NaN} />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("size=sm は Figma の 66×38 を使う", () => {
    const { container } = render(
      <ScoreGauge animate={false} size="sm" value={82} />,
    );

    expect(container.firstElementChild).toHaveClass("h-9.5", "w-16.5");
  });
});
