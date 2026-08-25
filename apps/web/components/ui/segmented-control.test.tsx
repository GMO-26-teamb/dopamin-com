import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./segmented-control";

const OPTIONS = [
  { value: "standard", label: "スタンダード" },
  { value: "goku", label: "ドパモード" },
] as const;

describe("SegmentedControl", () => {
  it("role=group と aria-label を持ち、選択中のセグメントだけ aria-pressed が true になる", () => {
    render(
      <SegmentedControl
        aria-label="テーマ"
        onChange={() => {}}
        options={OPTIONS}
        value="standard"
      />,
    );

    expect(screen.getByRole("group", { name: "テーマ" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "スタンダード" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "ドパモード" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("未選択のセグメントをクリックすると onChange が呼ばれる", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedControl
        aria-label="テーマ"
        onChange={onChange}
        options={OPTIONS}
        value="standard"
      />,
    );

    await user.click(screen.getByRole("button", { name: "ドパモード" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("goku");
  });

  it("ArrowRight で右のセグメントを選択してフォーカスを移す", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedControl
        aria-label="テーマ"
        onChange={onChange}
        options={OPTIONS}
        value="standard"
      />,
    );

    screen.getByRole("button", { name: "スタンダード" }).focus();
    await user.keyboard("{ArrowRight}");

    expect(onChange).toHaveBeenCalledWith("goku");
    expect(screen.getByRole("button", { name: "ドパモード" })).toHaveFocus();
  });

  it("ArrowLeft で左のセグメントに戻る", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedControl
        aria-label="テーマ"
        onChange={onChange}
        options={OPTIONS}
        value="goku"
      />,
    );

    screen.getByRole("button", { name: "ドパモード" }).focus();
    await user.keyboard("{ArrowLeft}");

    expect(onChange).toHaveBeenCalledWith("standard");
    expect(screen.getByRole("button", { name: "スタンダード" })).toHaveFocus();
  });
});
