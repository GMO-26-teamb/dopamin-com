import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TransfersPage from "@/app/(app)/transfers/page";
import { ApiClientError } from "@/lib/api/errors";
import { MOCK_NOW } from "@/lib/api/mock/fixtures";
import {
  createMockServices,
  resetMockStore,
} from "@/lib/api/mock/mock-services";
import type { MockScenario } from "@/lib/api/mock/scenario";
import { AppProviders } from "@/lib/api/query-client";
import type { Services } from "@/lib/api/services";

// `useSearchParams()` は App Router のコンテキストが要るので、URL から直接読む形に差し替える
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

function servicesFor(scenario: MockScenario): Services {
  return createMockServices(scenario, { delayMs: 0 });
}

function renderPage(url: string, services: Services) {
  window.history.replaceState({}, "", url);
  return render(
    <AppProviders services={services}>
      <TransfersPage />
    </AppProviders>,
  );
}

beforeEach(() => {
  // fixtures の `actByAt` は MOCK_NOW + 15〜20 分なので、時計を固定しないと
  // 実時刻が過ぎた時点で「期限切れ」になり承認 / 取消が Disabled になってしまう。
  // `toFake: ["Date"]` で `setTimeout` は本物のまま（Testing Library / user-event 用）。
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(MOCK_NOW));
  resetMockStore();
  window.history.replaceState({}, "", "/transfers");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("S-50 一覧", () => {
  it("3 セクションと件数メタを出す", async () => {
    renderPage("/transfers", servicesFor("default"));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "受信した申請（移管 OUT）" }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("heading", { name: "申請中（移管 IN）" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "履歴" })).toBeInTheDocument();
    expect(
      screen.getByText("受信 1 · 申請中 1 · 履歴 1 · Poll 消化済み"),
    ).toBeInTheDocument();
    // fixtures: 受信 = tkt-lab.net(out/pending) / 申請中 = harupika.xyz(import_pending)
    expect(screen.getByText("tkt-lab.net")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "harupika.xyz の取り込みを再試行" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "old-blog.xyz" }),
    ).toBeInTheDocument();
  });

  it("?domain= を申請フォームに引き継ぐ", async () => {
    renderPage("/transfers?domain=harupika.xyz", servicesFor("default"));

    await waitFor(() => {
      expect(screen.getByLabelText("ドメイン名")).toHaveValue("harupika.xyz");
    });
  });
});

describe("S-51 0 件", () => {
  it("フォーム + Empty State を出す", async () => {
    renderPage("/transfers?mock=empty", servicesFor("empty"));

    await waitFor(() => {
      expect(screen.getByText("移管はまだありません")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "申請" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "履歴" })).toBeNull();
  });
});

describe("読み込み中", () => {
  it("Skeleton を出す（?mock=loading）", () => {
    renderPage("/transfers?mock=loading", createMockServices("loading"));

    expect(screen.getByRole("status", { name: "読み込み中" })).toBeVisible();
  });
});

describe("S-52 申請エラー（AC-12-2）", () => {
  it("誤った AuthCode は 2202 の理由を Error Card に出す", async () => {
    const user = userEvent.setup();
    renderPage("/transfers", servicesFor("default"));
    await waitFor(() => {
      expect(screen.getByText("tkt-lab.net")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("ドメイン名"), "brought-in.example");
    await user.type(screen.getByLabelText("AuthCode"), "bad");
    await user.click(screen.getByRole("button", { name: "申請" }));

    await waitFor(() => {
      expect(
        screen.getByText("2202: AuthCode が正しくありません。"),
      ).toBeInTheDocument();
    });
  });

  it("?mock=conflict は 2300（すでに移管申請中）を出す", async () => {
    const user = userEvent.setup();
    renderPage("/transfers?mock=conflict", servicesFor("conflict"));
    await waitFor(() => {
      expect(screen.getByText("tkt-lab.net")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("ドメイン名"), "brought-in.example");
    await user.type(screen.getByLabelText("AuthCode"), "AUTH-1234");
    await user.click(screen.getByRole("button", { name: "申請" }));

    await waitFor(() => {
      expect(
        screen.getByText("2300: すでに移管申請中です。"),
      ).toBeInTheDocument();
    });
  });
});

describe("S-53 更新エラー（FR-18）", () => {
  it("Banner Warn + キャッシュ表示にして、承認 / 拒否 / 申請を止める", async () => {
    const base = servicesFor("default");
    const services: Services = {
      ...base,
      transfers: {
        ...base.transfers,
        refresh: () =>
          Promise.reject(
            new ApiClientError({
              code: "REGISTRY_UNAVAILABLE",
              message: "レジストリに接続できませんでした。",
              registry: "kitaqsign",
            }),
          ),
      },
    };
    const user = userEvent.setup();
    renderPage("/transfers", services);
    await waitFor(() => {
      expect(screen.getByText("tkt-lab.net")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "状態を更新" }));

    const banner = await screen.findByRole("alert");
    expect(
      within(banner).getByText("Kitaqsign に接続できません"),
    ).toBeInTheDocument();
    expect(
      within(banner).getByText(/表示は最後に取得した内容です。/),
    ).toBeInTheDocument();
    // キャッシュ表示は残る
    expect(screen.getByText("tkt-lab.net")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "tkt-lab.net の移管を承認" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "tkt-lab.net の移管を拒否" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "申請" })).toBeDisabled();
    // 再照会（状態を確認 / 再試行）は spec S-53 の Disabled 対象ではないので残す
    expect(
      screen.getByRole("button", { name: "harupika.xyz の取り込みを再試行" }),
    ).toBeEnabled();
    expect(
      screen.getByText("受信 1 · 申請中 1 · 履歴 1 · 最終更新に失敗"),
    ).toBeInTheDocument();
  });

  it("キャッシュが無い取得失敗は Error Card + 再試行", async () => {
    const base = servicesFor("error");
    const services: Services = {
      ...base,
      transfers: {
        ...base.transfers,
        // 自動再試行（指数バックオフ）を待たずに済むよう retryable を落とす
        list: () =>
          Promise.reject(
            new ApiClientError({
              code: "REGISTRY_UNAVAILABLE",
              message: "レジストリに接続できませんでした。",
              registry: "kitaqsign",
              retryable: false,
            }),
          ),
      },
    };
    renderPage("/transfers?mock=error", services);

    await waitFor(() => {
      expect(screen.getByText("REGISTRY_UNAVAILABLE")).toBeInTheDocument();
    });
    expect(screen.queryByRole("heading", { name: "履歴" })).toBeNull();
  });
});

describe("D-08 取消 / D-06 承認", () => {
  it("申請 → 申請中に追加 → 取消ダイアログ → Banner Ok", async () => {
    const user = userEvent.setup();
    renderPage("/transfers", servicesFor("default"));
    await waitFor(() => {
      expect(screen.getByText("tkt-lab.net")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("ドメイン名"), "brought-in.example");
    await user.type(screen.getByLabelText("AuthCode"), "AUTH-1234");
    await user.click(screen.getByRole("button", { name: "申請" }));

    await waitFor(() => {
      expect(screen.getByText("移管を申請しました")).toBeInTheDocument();
    });
    expect(screen.getByText("brought-in.example")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "brought-in.example の移管申請を取消",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        "brought-in.example の移管申請を取り消しますか？",
      ),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "取り消す" }));
    await waitFor(() => {
      expect(screen.getByText("移管申請を取り消しました")).toBeInTheDocument();
    });
  });

  it("承認はドメイン名の再入力で解錠する（§15.2）", async () => {
    const user = userEvent.setup();
    renderPage("/transfers", servicesFor("default"));
    await waitFor(() => {
      expect(screen.getByText("tkt-lab.net")).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", { name: "tkt-lab.net の移管を承認" }),
    );
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "承認する" });
    expect(confirm).toBeDisabled();

    await user.type(
      within(dialog).getByLabelText("確認のためドメイン名を入力"),
      "tkt-lab.net",
    );
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    await waitFor(() => {
      expect(screen.getByText("移管を承認しました")).toBeInTheDocument();
    });
  });

  it("承認の失敗は対象を明示し、再試行はダイアログを開き直す（§15.2）", async () => {
    const base = servicesFor("default");
    const services: Services = {
      ...base,
      transfers: {
        ...base.transfers,
        approve: () =>
          Promise.reject(
            new ApiClientError({
              code: "REGISTRY_UNAVAILABLE",
              message: "レジストリに接続できませんでした。",
              registry: "kitaqsign",
            }),
          ),
      },
    };
    const user = userEvent.setup();
    renderPage("/transfers", services);
    await waitFor(() => {
      expect(screen.getByText("tkt-lab.net")).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", { name: "tkt-lab.net の移管を承認" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("確認のためドメイン名を入力"),
      "tkt-lab.net",
    );
    await user.click(within(dialog).getByRole("button", { name: "承認する" }));

    await waitFor(() => {
      expect(
        screen.getByText("tkt-lab.net の承認に失敗しました"),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    // Error Card の「再試行」は mutate を直接叩かず、再入力からやり直させる
    await user.click(screen.getByRole("button", { name: "再試行" }));
    const reopened = await screen.findByRole("dialog");
    expect(
      within(reopened).getByRole("button", { name: "承認する" }),
    ).toBeDisabled();
  });
});
