import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api/errors";
import { ErrorCard } from "./error-card";

const timeout = () =>
  new ApiClientError({
    code: "REGISTRY_TIMEOUT",
    message: "",
    registry: "kitaqsign",
    requestId: "req_01J8Z…K2",
  });

describe("ErrorCard", () => {
  it("REGISTRY_TIMEOUT はレジストリ名入りの文言を出す", () => {
    render(<ErrorCard error={timeout()} />);

    expect(
      screen.getByText("Kitaqsign が応答しませんでした"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ローカルの情報は変更されていません/),
    ).toBeInTheDocument();
  });

  it("エラーコード・HTTP ステータス・リクエスト ID を並べる", () => {
    render(<ErrorCard error={timeout()} />);

    expect(screen.getByText("REGISTRY_TIMEOUT")).toBeInTheDocument();
    expect(screen.getByText("504")).toBeInTheDocument();
    expect(screen.getByText("req_01J8Z…K2")).toBeInTheDocument();
  });

  it("onRetry を渡すと再試行ボタンが出て、押すと呼ばれる", async () => {
    const onRetry = vi.fn();
    render(<ErrorCard error={timeout()} onRetry={onRetry} />);

    const retry = screen.getByRole("button", { name: "再試行" });
    await userEvent.setup().click(retry);

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("再試行できないエラーでは再試行ボタンを出さない", () => {
    const error = new ApiClientError({
      code: "VALIDATION_ERROR",
      message: "",
    });
    render(<ErrorCard error={error} onRetry={() => {}} />);

    expect(screen.queryByRole("button", { name: "再試行" })).toBeNull();
    expect(screen.getByText("入力内容を確認してください")).toBeInTheDocument();
  });

  it("showLogsLink で操作ログへのリンクを出す", () => {
    render(<ErrorCard error={timeout()} showLogsLink />);

    expect(
      screen.getByRole("link", { name: "操作ログを見る" }),
    ).toHaveAttribute("href", "/logs");
  });

  it("HTTP ステータスを持たないコード（NETWORK）ではバッジを出さない", () => {
    const error = new ApiClientError({ code: "NETWORK", message: "" });
    render(<ErrorCard error={error} />);

    expect(screen.getByText("NETWORK")).toBeInTheDocument();
    expect(screen.getByText("通信に失敗しました")).toBeInTheDocument();
  });

  it("role=alert で読み上げる", () => {
    render(<ErrorCard error={timeout()} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Kitaqsign が応答しませんでした",
    );
  });
});
