import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "./input";

describe("Input", () => {
  it("label を渡すとラベルと入力欄が関連づく", () => {
    render(<Input label="表示名（1〜32文字）" placeholder="ニックネーム" />);

    expect(screen.getByLabelText("表示名（1〜32文字）")).toBeInTheDocument();
  });

  it("helper は muted で表示し、aria-describedby でつなぐ", () => {
    render(
      <Input
        helper="生体認証またはPINを使います。パスワードは作りません。"
        label="表示名"
      />,
    );

    const input = screen.getByLabelText("表示名");
    const helper = screen.getByText(
      "生体認証またはPINを使います。パスワードは作りません。",
    );
    expect(helper).toHaveClass("text-muted");
    expect(input).toHaveAttribute("aria-describedby", helper.id);
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("error を渡すと aria-invalid が立ち、helper 位置に warn 色で文言が出る", () => {
    render(
      <Input
        error="この名前は使えません"
        helper="半角英数字とハイフン"
        label="ドメイン名"
      />,
    );

    const input = screen.getByLabelText("ドメイン名");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveClass("border-warn");

    const message = screen.getByText("この名前は使えません");
    expect(message).toHaveClass("text-warn");
    expect(input).toHaveAttribute("aria-describedby", message.id);
    // error があるときは helper 文言を出さない
    expect(screen.queryByText("半角英数字とハイフン")).not.toBeInTheDocument();
  });

  it("monospace で Code/Input のテキストスタイルになる", () => {
    render(<Input label="AuthCode" monospace />);

    expect(screen.getByLabelText("AuthCode")).toHaveClass("text-code-input");
  });

  it("surface で入力欄の背景が入れ替わる", () => {
    const { rerender } = render(<Input label="名前" surface="bg" />);
    expect(screen.getByLabelText("名前")).toHaveClass("bg-panel");

    rerender(<Input label="名前" surface="panel" />);
    expect(screen.getByLabelText("名前")).toHaveClass("bg-bg");
  });
});
