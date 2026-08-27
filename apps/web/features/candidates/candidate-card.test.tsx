import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Candidate, UniquenessScore } from "@/lib/api/types";
import { CandidateCard } from "./candidate-card";

/**
 * ui-screens §2.3 の「Rarity とスコアラベルの対応（FR-05）」を 5 パターンとも固定する。
 * SSR / R / N は空き、Taken は取得済み、Unknown は check 失敗。
 */

function score(value: number): UniquenessScore {
  return {
    score: value,
    label: value >= 70 ? "high" : value >= 40 ? "medium" : "low",
    nearest: [
      { name: "takaku.com", similarity: 0.61 },
      { name: "takoyaki.com", similarity: 0.55 },
      { name: "tacos.com", similarity: 0.41 },
    ],
  };
}

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    sld: "takutaku",
    tld: "com",
    reason: "呼び名そのままで覚えやすい",
    registry: "kitaqsign",
    availability: "available",
    uniqueness: score(86),
    alternatives: [],
    ...overrides,
  };
}

function setup(value: Candidate, registered = false) {
  const onRegister = vi.fn();
  const onShowAlternatives = vi.fn();
  const onRetry = vi.fn();
  render(
    <CandidateCard
      candidate={value}
      onRegister={onRegister}
      onRetry={onRetry}
      onShowAlternatives={onShowAlternatives}
      registered={registered}
    />,
  );
  return { onRegister, onShowAlternatives, onRetry };
}

describe("CandidateCard", () => {
  it("SSR: 空き かつ 独自性 high は「空き」と「登録へ」を出す", async () => {
    const { onRegister } = setup(candidate());

    expect(screen.getByText("SSR")).toBeInTheDocument();
    expect(screen.getByText("空き")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "登録へ" }));
    expect(onRegister).toHaveBeenCalledTimes(1);
  });

  it("R: 独自性 medium は Rarity が R になる", () => {
    setup(candidate({ uniqueness: score(52) }));

    expect(screen.getByText("R")).toBeInTheDocument();
    expect(screen.getByText("空き")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登録へ" })).toBeEnabled();
  });

  it("N: 独自性 low は「紛らわしい」と「それでも登録」になる", async () => {
    const { onRegister } = setup(candidate({ uniqueness: score(24) }));

    expect(screen.getByText("N")).toBeInTheDocument();
    expect(screen.getByText("紛らわしい")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "登録へ" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "それでも登録" }));
    expect(onRegister).toHaveBeenCalledTimes(1);
  });

  it("Taken: 取得済みは Rarity を出さず「代替を見る」で代替候補を渡す", async () => {
    const { onShowAlternatives } = setup(
      candidate({
        availability: "unavailable",
        uniqueness: score(86),
        alternatives: ["takutaku.xyz", "taku-taku.com"],
      }),
    );

    expect(screen.getByText("取得済み")).toBeInTheDocument();
    expect(screen.queryByText("SSR")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "代替を見る" }));
    expect(onShowAlternatives).toHaveBeenCalledWith([
      "takutaku.xyz",
      "taku-taku.com",
    ]);
  });

  it("Unknown: check 失敗はスコアを残したまま「確認不可」と「再試行」を出す", async () => {
    const { onRetry } = setup(candidate({ availability: "error" }));

    expect(screen.getByText("確認不可")).toBeInTheDocument();
    // スコアは表示する（ui-screens §2.3 Unknown）
    expect(screen.getByText("SSR")).toBeInTheDocument();
    expect(
      screen.getByText(/空き状況を確認できませんでした/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(onRetry).toHaveBeenCalledWith("takutaku.com");
  });

  it("独自性スコアが無いときはゲージも Rarity も出さない", () => {
    setup(candidate({ uniqueness: null }));

    expect(screen.queryByText("SSR")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /似ている名前/ }),
    ).not.toBeInTheDocument();
  });

  it("「似ている名前」のトグルで 3 件を開閉できる", async () => {
    setup(candidate());

    // 既定は開いた状態（Figma S-22）
    expect(screen.getByText("takaku.com")).toBeInTheDocument();
    expect(screen.getByText("takoyaki.com")).toBeInTheDocument();
    expect(screen.getByText("tacos.com")).toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "似ている名前" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(toggle);

    expect(screen.queryByText("takaku.com")).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("ゲージは押せる要素にせず、主操作を当たり判定でも主役にする（#218）", () => {
    setup(candidate());

    // ゲージ自体はボタンの中に入っていない
    expect(screen.getByText(/独自性スコア/).closest("button")).toBeNull();
    // 主操作は Medium（h-control-md）で、開閉トグルより大きい
    expect(screen.getByRole("button", { name: /登録へ/ })).toHaveClass(
      "h-control-md",
    );
  });

  it("登録直後は「取得しました」と詳細リンクに差し替わる（S-26 を閉じたあと）", () => {
    setup(candidate(), true);

    expect(screen.getByText("取得しました")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "詳細" })).toHaveAttribute(
      "href",
      "/domains/takutaku.com",
    );
  });
});
