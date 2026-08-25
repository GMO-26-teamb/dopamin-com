import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge";

describe("Badge", () => {
  it("既定は Neutral の Outline（1.5px 枠 + ink 文字）", () => {
    render(<Badge>空き</Badge>);

    const badge = screen.getByText("空き").parentElement;
    expect(badge).toHaveClass("border-[length:var(--stroke-medium)]");
    expect(badge).toHaveClass("border-ink", "text-ink");
  });

  it("tone ごとに枠と文字の色が変わる", () => {
    const { rerender } = render(<Badge tone="warn">失敗</Badge>);
    expect(screen.getByText("失敗").parentElement).toHaveClass(
      "border-warn",
      "text-warn",
    );

    rerender(<Badge tone="muted">停止中</Badge>);
    expect(screen.getByText("停止中").parentElement).toHaveClass(
      "border-muted",
      "text-muted",
    );

    rerender(<Badge tone="ok">有効</Badge>);
    expect(screen.getByText("有効").parentElement).toHaveClass(
      "border-ok",
      "text-ok",
    );
  });

  it("variant=solid は枠ではなく塗りになる", () => {
    render(
      <Badge tone="neutral" variant="solid">
        空き
      </Badge>,
    );

    const badge = screen.getByText("空き").parentElement;
    expect(badge).toHaveClass("bg-ink", "text-bg");
    expect(badge).not.toHaveClass("border-[length:var(--stroke-medium)]");
  });

  it("tone=brand の Outline は枠も文字もグラデーションになる", () => {
    render(<Badge tone="brand">おすすめ</Badge>);

    const label = screen.getByText("おすすめ");
    expect(label).toHaveClass("brand-text");
    expect(label.parentElement).toHaveClass(
      "[border-image:var(--gradient-brand)_1]",
    );
  });

  it("icon を渡すとラベルの前に描画する", () => {
    render(
      <Badge icon={<svg aria-hidden="true" data-testid="icon" />}>空き</Badge>,
    );

    const icon = screen.getByTestId("icon");
    expect(icon).toBeInTheDocument();
    // アイコン枠 → ラベルの順
    const badge = screen.getByText("空き").parentElement;
    expect(badge?.firstElementChild).toContainElement(icon);
  });

  it("icon を渡さないとアイコン枠を描画しない", () => {
    render(<Badge>空き</Badge>);

    const badge = screen.getByText("空き").parentElement;
    expect(badge?.childElementCount).toBe(1);
  });
});
