import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMockServices } from "@/lib/api/mock/mock-services";
import { AppProviders } from "@/lib/api/query-client";
import { AiLogPanel } from "./ai-log-panel";

function setup(open: boolean) {
  const services = createMockServices("default", { delayMs: 0 });
  const ai = vi.spyOn(services.logs, "ai");
  render(
    <AppProviders services={services}>
      <AiLogPanel onOpenChange={() => {}} open={open} />
    </AppProviders>,
  );
  return { ai };
}

describe("AiLogPanel", () => {
  it("閉じている間は AI ログを取りに行かない", () => {
    const { ai } = setup(false);

    expect(ai).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("開いたときに取得して一覧を出す", async () => {
    const { ai } = setup(true);

    expect(ai).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog", { name: "AI ログ" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText(/^入力: /).length).toBeGreaterThan(0);
    });
    expect(
      screen.getByRole("link", { name: "すべてのログを見る" }),
    ).toHaveAttribute("href", "/logs?tab=ai");
  });
});
