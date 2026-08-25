import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("既定は type=button の Primary（グラデ面 + グロー）", () => {
    render(<Button>登録する</Button>);

    const button = screen.getByRole("button", { name: "登録する" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass(
      "bg-[image:var(--gradient-brand)]",
      "text-on-brand",
      "shadow-[var(--glow-brand)]",
    );
  });

  it("loading で disabled と aria-busy が立つ", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        送信中
      </Button>,
    );

    const button = screen.getByRole("button", { name: "送信中" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("loading でないときは aria-busy を付けない", () => {
    render(<Button>送信</Button>);

    expect(screen.getByRole("button", { name: "送信" })).not.toHaveAttribute(
      "aria-busy",
    );
  });

  it("asChild で <a> にスタイルとハンドラが移る", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button asChild onClick={onClick} variant="primary">
        {/* jsdom が別ドキュメントへの遷移で警告を出さないよう同一文書内リンクにする */}
        <a href="#x">ラベル</a>
      </Button>,
    );

    // button ではなく link として描画される
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: "ラベル" });
    expect(link).toHaveAttribute("href", "#x");
    expect(link).toHaveClass(
      "bg-[image:var(--gradient-brand)]",
      "text-on-brand",
      "h-control-md",
    );

    await user.click(link);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("asChild + leadingIcon でもアイコンが <a> の中に入る", () => {
    render(
      <Button
        asChild
        leadingIcon={<svg aria-hidden="true" data-testid="icon" />}
        trailingIcon={<svg aria-hidden="true" data-testid="trailing" />}
      >
        <a href="/x">ラベル</a>
      </Button>,
    );

    const link = screen.getByRole("link", { name: "ラベル" });
    expect(link).toContainElement(screen.getByTestId("icon"));
    expect(link).toContainElement(screen.getByTestId("trailing"));
  });

  it("asChild では type / disabled を子要素に流さない", () => {
    render(
      <Button asChild disabled>
        <a href="/x">ラベル</a>
      </Button>,
    );

    const link = screen.getByRole("link", { name: "ラベル" });
    expect(link).not.toHaveAttribute("type");
    expect(link).not.toHaveAttribute("disabled");
  });

  it("size でコントロール高さとテキストスタイルが変わる", () => {
    const { rerender } = render(<Button size="sm">小</Button>);
    expect(screen.getByRole("button", { name: "小" })).toHaveClass(
      "h-control-sm",
      "text-label-sm",
    );

    rerender(<Button size="lg">大</Button>);
    expect(screen.getByRole("button", { name: "大" })).toHaveClass(
      "h-control-lg",
      "text-label",
    );
  });
});
