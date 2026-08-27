import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiClientError } from "@/lib/api/errors";
import {
  createMockServices,
  resetMockStore,
} from "@/lib/api/mock/mock-services";
import { AppProviders } from "@/lib/api/query-client";
import type { Services } from "@/lib/api/services";
import { TrialScore } from "./trial-score";

function renderTrial(
  scenario: "default" | "error" = "default",
  override?: (services: Services) => Services,
) {
  const services = createMockServices(scenario, { delayMs: 0 });
  render(
    <AppProviders
      services={override === undefined ? services : override(services)}
    >
      <TrialScore />
    </AppProviders>,
  );
}

/** `POST /uniqueness/preview` だけを差し替える（レート制限は実 API 側でしか起きない）。 */
function withPreviewError(error: ApiClientError) {
  return (services: Services): Services => ({
    ...services,
    uniqueness: {
      preview: () => Promise.reject(error),
    },
  });
}

beforeEach(() => {
  resetMockStore();
  window.history.replaceState({}, "", "/");
});

describe("TrialScore（S-00 お試しスコア）", () => {
  it("ログイン前でも入力欄とボタンを操作できる", () => {
    renderTrial();

    expect(screen.getByLabelText("ためしてみる")).toBeEnabled();
    expect(screen.getByRole("button", { name: "スコアを見る" })).toBeEnabled();
    expect(screen.queryByText("ログイン後に利用可")).not.toBeInTheDocument();
  });

  it("結果が出ていなくても、何が返るのかと試せる例を出す", () => {
    renderTrial();

    expect(screen.getByText(/いちばん近い既存の名前/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "gogle" })).toBeInTheDocument();
    expect(screen.queryByText("独自性スコア")).not.toBeInTheDocument();
  });

  it("スコアを見るとゲージと類似候補が出る", async () => {
    renderTrial();

    await userEvent.type(screen.getByLabelText("ためしてみる"), "gogle");
    await userEvent.click(screen.getByRole("button", { name: "スコアを見る" }));

    expect(await screen.findByText("独自性スコア")).toBeInTheDocument();
    // Similarity Row は 0〜1 の類似度を小数 2 桁で出す
    expect(screen.getAllByText(/^0\.\d{2}$/).length).toBeGreaterThanOrEqual(1);
  });

  it("例を押すとそのままスコアが出る", async () => {
    renderTrial();

    await userEvent.click(screen.getByRole("button", { name: "takutaku" }));

    expect(await screen.findByText("独自性スコア")).toBeInTheDocument();
    expect(screen.getByLabelText("ためしてみる")).toHaveValue("takutaku");
  });

  it("FQDN で入れても判定に使った SLD を見せる", async () => {
    renderTrial();

    await userEvent.type(screen.getByLabelText("ためしてみる"), "gogle.com");
    await userEvent.click(screen.getByRole("button", { name: "スコアを見る" }));

    expect(await screen.findByText("独自性スコア")).toBeInTheDocument();
    expect(screen.getByText("gogle")).toBeInTheDocument();
  });

  it("形式が不正なら API を呼ばずに Helper で知らせる", async () => {
    renderTrial();

    const input = screen.getByLabelText("ためしてみる");
    await userEvent.type(input, "とても 変な 名前");
    await userEvent.click(screen.getByRole("button", { name: "スコアを見る" }));

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("独自性スコア")).not.toBeInTheDocument();
  });

  it("スコアを計算できなければ Error Card と再試行を出す", async () => {
    renderTrial("error");

    await userEvent.type(screen.getByLabelText("ためしてみる"), "gogle");
    await userEvent.click(screen.getByRole("button", { name: "スコアを見る" }));

    const card = await screen.findByRole("alert");
    expect(card).toHaveTextContent("INTERNAL");
    expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
  });

  it("回数の上限に当たったら、あと何秒で試せるかと再試行を出す", async () => {
    renderTrial(
      "default",
      withPreviewError(
        new ApiClientError({
          code: "RATE_LIMITED",
          message: "アクセスが集中しています。",
          retryable: true,
          details: { retryAfter: 6 },
        }),
      ),
    );

    await userEvent.type(screen.getByLabelText("ためしてみる"), "gogle");
    await userEvent.click(screen.getByRole("button", { name: "スコアを見る" }));

    const card = await screen.findByRole("alert");
    expect(card).toHaveTextContent("6 秒後に再試行してください。");
    expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
  });
});
