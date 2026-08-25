import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiClientError } from "@/lib/api/errors";
import {
  createMockServices,
  resetMockStore,
} from "@/lib/api/mock/mock-services";
import { ServicesProvider } from "@/lib/api/provider";
import type { Services } from "@/lib/api/services";
import type { Me } from "@/lib/api/types";
import { ThemeProvider } from "@/lib/theme/theme-provider";
import { SettingsScreen } from "./settings-screen";

/** radix は body に pointer-events:none を敷くので、user-event の判定は切る */
const user = () => userEvent.setup({ pointerEventsCheck: 0 });

/** radix Select / Dialog が jsdom に無い API を使うので最低限だけ生やす */
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const ME: Me = {
  user: { id: "u1", displayName: "デモユーザー" },
  features: { demoReset: true },
  ai: {
    provider: "google",
    model: "gemini-2.5-flash",
    providers: [
      { id: "google", models: ["gemini-2.5-flash", "gemini-2.5-pro"] },
      { id: "anthropic", models: ["claude-sonnet-4-5", "claude-haiku-4-5"] },
    ],
  },
};

function renderScreen(services: Services) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ServicesProvider services={services}>{children}</ServicesProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
  render(<SettingsScreen />, { wrapper });
}

/** モックのシナリオ差だけを見たいときに使う（`?mock=` 相当） */
function mockScenario(scenario: Parameters<typeof createMockServices>[0]) {
  return createMockServices(scenario, { delayMs: 0 });
}

function stubServices(settings: Partial<Services["settings"]>): Services {
  const base = mockScenario("default");
  return { ...base, settings: { ...base.settings, ...settings } };
}

describe("SettingsScreen", () => {
  beforeEach(() => {
    resetMockStore();
  });

  it("読み込み中はカードの骨組みを出す", () => {
    renderScreen(stubServices({ me: () => new Promise<Me>(() => {}) }));

    expect(screen.getByRole("heading", { name: "設定" })).toBeInTheDocument();
    // カードの見出しは骨組みでも出す（形を実コンテンツに合わせる。ui-screens §4）
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText("パスキー管理")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "パスキーを追加" })).toBeNull();
    expect(screen.queryByRole("button", { name: "リセット実行" })).toBeNull();
  });

  it("取得に失敗したら Error Card と再試行を出す（HTTP モードの NOT_IMPLEMENTED 相当）", async () => {
    renderScreen(
      stubServices({
        me: () =>
          Promise.reject(
            new ApiClientError({
              code: "INTERNAL",
              message: "設定を取得できませんでした。",
            }),
          ),
      }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("INTERNAL");
    expect(
      within(alert).getByRole("button", { name: "再試行" }),
    ).toBeInTheDocument();
  });

  it("features.demoReset が false ならリセットのカードを出さない（§7-3）", async () => {
    renderScreen(
      stubServices({
        me: () => Promise.resolve({ ...ME, features: { demoReset: false } }),
      }),
    );

    expect(await screen.findByText("AI 設定")).toBeInTheDocument();
    expect(screen.queryByText("デモデータリセット")).toBeNull();
    expect(screen.queryByRole("button", { name: "リセット実行" })).toBeNull();
  });

  it("D-10 は「reset」の再入力が一致するまで実行できず、成功したら S-71 の Banner Ok を出す", async () => {
    renderScreen(mockScenario("default"));

    await user().click(
      await screen.findByRole("button", { name: "リセット実行" }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "デモデータをリセットしますか？",
    });
    const confirm = within(dialog).getByRole("button", {
      name: "リセット実行",
    });
    expect(confirm).toBeDisabled();

    await user().type(
      within(dialog).getByLabelText("確認のため「reset」と入力"),
      "reset",
    );
    expect(confirm).toBeEnabled();

    await user().click(confirm);

    const banner = await screen.findByText("デモデータをリセットしました");
    expect(banner).toBeInTheDocument();
    expect(
      screen.getByText(/デモ用ドメイン 4 件を投入しました/),
    ).toBeInTheDocument();
  });

  it("リセットに失敗したら Error Card を出す（?mock=error）", async () => {
    renderScreen(mockScenario("error"));

    await user().click(
      await screen.findByRole("button", { name: "リセット実行" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "デモデータをリセットしますか？",
    });
    await user().type(
      within(dialog).getByLabelText("確認のため「reset」と入力"),
      "reset",
    );
    await user().click(
      within(dialog).getByRole("button", { name: "リセット実行" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("INTERNAL");
    expect(screen.queryByText("デモデータをリセットしました")).toBeNull();
  });

  it("?mock=conflict なら削除が 409 になり CONFLICT の Error Card を出す（D-09）", async () => {
    renderScreen(mockScenario("conflict"));

    await user().click(
      await screen.findByRole("button", { name: "iPhone のパスキーを削除" }),
    );
    await user().click(await screen.findByRole("button", { name: "削除する" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("CONFLICT");
    expect(alert).toHaveTextContent("最後のパスキーは削除できません。");
  });

  it("?mock=error ならパスキー追加が失敗し S-70b の Banner Warn を出す", async () => {
    renderScreen(mockScenario("error"));

    await user().click(
      await screen.findByRole("button", { name: "パスキーを追加" }),
    );

    expect(
      await screen.findByText("パスキーを追加できませんでした"),
    ).toBeInTheDocument();
  });

  it("AI 設定を切り替えると保存し、S-70b の Banner Ok を出す（FR-17）", async () => {
    renderScreen(mockScenario("default"));

    await user().click(await screen.findByRole("combobox", { name: "モデル" }));
    await user().click(
      await screen.findByRole("option", { name: "gemini-2.5-pro" }),
    );

    expect(
      await screen.findByText("AI 設定を保存しました"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "モデル" }),
      ).toHaveTextContent("gemini-2.5-pro"),
    );
  });
});
