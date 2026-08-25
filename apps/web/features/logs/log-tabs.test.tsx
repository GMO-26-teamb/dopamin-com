import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockServices } from "@/lib/api/mock/mock-services";
import { AppProviders } from "@/lib/api/query-client";
import { LogTabs } from "./log-tabs";

/**
 * S-60 ⇄ S-61 のタブ切り替え（ui-screens §3）。
 * P-01 の「すべてのログを見る」→ `/logs?tab=ai` がそのまま S-61 に着地することと、
 * タブを変えても `?mock=` が消えないことを担保する。
 */

const replace = vi.fn();
let search = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/logs",
  useSearchParams: () => new URLSearchParams(search),
}));

function setup(query: string) {
  search = query;
  render(
    <AppProviders services={createMockServices("default", { delayMs: 0 })}>
      <LogTabs />
    </AppProviders>,
  );
}

describe("LogTabs", () => {
  beforeEach(() => {
    replace.mockClear();
  });

  it("既定では操作ログのタブを開く（S-60）", async () => {
    setup("");

    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent(
      "操作ログ",
    );
    await waitFor(() => {
      expect(screen.getByText("操作ログ 5 · AI ログ 4")).toBeInTheDocument();
    });
    expect(screen.getByRole("list", { name: "操作ログ" })).toBeInTheDocument();
  });

  it("?tab=ai で AI ログのタブを開く（S-61 への直リンク）", async () => {
    setup("tab=ai");

    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent(
      "AI ログ",
    );
    await waitFor(() => {
      expect(screen.getByRole("list", { name: "AI ログ" })).toBeInTheDocument();
    });
  });

  it("タブを変えても ?mock= を残したまま ?tab= だけ差し替える", async () => {
    const user = userEvent.setup();
    setup("mock=empty");

    await user.click(screen.getByRole("tab", { name: /AI ログ/ }));
    expect(replace).toHaveBeenCalledWith("/logs?mock=empty&tab=ai", {
      scroll: false,
    });
  });

  it("操作ログに戻すと ?tab= を落とす", async () => {
    const user = userEvent.setup();
    setup("mock=empty&tab=ai");

    await user.click(screen.getByRole("tab", { name: /操作ログ/ }));
    expect(replace).toHaveBeenCalledWith("/logs?mock=empty", { scroll: false });
  });
});
