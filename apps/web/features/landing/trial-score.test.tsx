import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createMockServices,
  resetMockStore,
} from "@/lib/api/mock/mock-services";
import { AppProviders } from "@/lib/api/query-client";
import { TrialScore } from "./trial-score";

function renderTrial(scenario: "default" | "error" = "default") {
  render(
    <AppProviders services={createMockServices(scenario, { delayMs: 0 })}>
      <TrialScore />
    </AppProviders>,
  );
}

beforeEach(() => {
  resetMockStore();
  window.history.replaceState({}, "", "/");
});

describe("TrialScore（S-00 お試しスコア）", () => {
  it("入力欄の横に「ログイン後に利用可」の注記を出す（ui-screens §7-1）", () => {
    renderTrial();

    expect(screen.getByText("ログイン後に利用可")).toBeInTheDocument();
    expect(screen.getByLabelText("ためしてみる")).toBeEnabled();
  });

  it("初期状態では結果を出さない", () => {
    renderTrial();

    expect(screen.queryByText(/独自性スコア/)).not.toBeInTheDocument();
  });

  it("スコアを見るとゲージと類似候補が出る", async () => {
    renderTrial();

    await userEvent.type(screen.getByLabelText("ためしてみる"), "gogle");
    await userEvent.click(screen.getByRole("button", { name: "スコアを見る" }));

    expect(await screen.findByText("独自性スコア")).toBeInTheDocument();
    // Similarity Row は 0〜1 のコサイン類似度を小数 2 桁で出す
    expect(screen.getAllByText(/^0\.\d{2}$/).length).toBeGreaterThanOrEqual(1);
  });

  it("形式が不正なら API を呼ばずに Helper で知らせる", async () => {
    renderTrial();

    const input = screen.getByLabelText("ためしてみる");
    await userEvent.type(input, "とても 変な 名前");
    await userEvent.click(screen.getByRole("button", { name: "スコアを見る" }));

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("独自性スコア")).not.toBeInTheDocument();
  });

  it("レジストリが落ちていたら Error Card と再試行を出す", async () => {
    renderTrial("error");

    await userEvent.type(screen.getByLabelText("ためしてみる"), "gogle");
    await userEvent.click(screen.getByRole("button", { name: "スコアを見る" }));

    const card = await screen.findByRole("alert");
    expect(card).toHaveTextContent("REGISTRY_UNAVAILABLE");
    expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
  });
});
