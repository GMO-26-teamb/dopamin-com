import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api/errors";
import { TransferForm } from "./transfer-form";

describe("TransferForm", () => {
  it("空欄のまま申請するとフィールドごとの文言を出し、送信しない", async () => {
    const onSubmit = vi.fn();
    render(<TransferForm onSubmit={onSubmit} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "申請" }));

    expect(
      screen.getByText("ドメイン名を入力してください"),
    ).toBeInTheDocument();
    expect(screen.getByText("AuthCode を入力してください")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("RFC 1035 に反するドメイン名は送信前に弾く（AC-03-3）", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<TransferForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("ドメイン名"), "-bad-.example");
    await user.type(screen.getByLabelText("AuthCode"), "AUTH-1234");
    await user.click(screen.getByRole("button", { name: "申請" }));

    expect(
      screen.getByText("ドメイン名の形式が正しくありません（例: example.com）"),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("正しい入力は小文字化・trim して送信する（AC-12-1）", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<TransferForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("ドメイン名"), "  TKT-Lab.NET  ");
    await user.type(screen.getByLabelText("AuthCode"), " AUTH-1234 ");
    await user.click(screen.getByRole("button", { name: "申請" }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "tkt-lab.net",
      authCode: "AUTH-1234",
    });
  });

  it("defaultDomain を初期値に入れる（?domain= からの引き継ぎ）", () => {
    render(<TransferForm defaultDomain="harupika.xyz" onSubmit={vi.fn()} />);

    expect(screen.getByLabelText("ドメイン名")).toHaveValue("harupika.xyz");
  });

  it("レジストリ拒否は Error Card で理由を出す（S-52 / AC-12-2）", () => {
    render(
      <TransferForm
        error={
          new ApiClientError({
            code: "REGISTRY_REJECTED",
            message: "AuthCode が正しくありません。",
            registry: "kitaqsign",
            registryCode: "2202",
          })
        }
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText("Kitaqsign が拒否しました")).toBeInTheDocument();
    expect(
      screen.getByText("2202: AuthCode が正しくありません。"),
    ).toBeInTheDocument();
    // 更新系の拒否は再試行ボタンを出さない（ui-screens S-52「Show Retry なし」）
    expect(screen.queryByRole("button", { name: "再試行" })).toBeNull();
  });

  it("submitting 中はラベルを「申請中…」にして二重送信を防ぐ", () => {
    render(<TransferForm onSubmit={vi.fn()} submitting />);

    expect(screen.getByRole("button", { name: "申請中…" })).toBeDisabled();
    expect(screen.getByLabelText("ドメイン名")).toBeDisabled();
  });

  it("disabled のとき（S-53）は申請できない", () => {
    render(<TransferForm disabled onSubmit={vi.fn()} />);

    expect(screen.getByRole("button", { name: "申請" })).toBeDisabled();
  });
});
