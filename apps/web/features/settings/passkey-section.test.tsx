import type { PasskeySummary } from "@dopamin/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api/errors";
import { ServicesProvider } from "@/lib/api/provider";
import type { Services } from "@/lib/api/services";
import { PASSKEY_NAME_ERROR, PasskeySection } from "./passkey-section";

/** radix は body に pointer-events:none を敷くので、user-event の判定は切る */
const user = () => userEvent.setup({ pointerEventsCheck: 0 });

const PASSKEYS: PasskeySummary[] = [
  {
    id: "pk_1",
    name: "MacBook Touch ID",
    deviceType: "multiDevice",
    backedUp: true,
    createdAt: "2026-08-25T10:00:00+09:00",
    lastUsedAt: "2026-08-26T09:57:00+09:00",
  },
  {
    id: "pk_2",
    name: "iPhone Face ID",
    deviceType: "singleDevice",
    backedUp: false,
    createdAt: "2026-08-25T10:00:00+09:00",
    lastUsedAt: null,
  },
];

type AuthOverrides = Partial<Services["auth"]>;

function createServices(auth: AuthOverrides): Services {
  const notImplemented = () => {
    throw new Error("この経路はテストで使わない");
  };
  return {
    auth: {
      isSupported: () => true,
      signup: notImplemented,
      login: notImplemented,
      logout: notImplemented,
      addPasskey: () => Promise.reject(new Error("未設定")),
      listPasskeys: () => Promise.resolve([...PASSKEYS]),
      deletePasskey: () => Promise.resolve(),
      renamePasskey: () => Promise.reject(new Error("未設定")),
      ...auth,
    },
    // 設定画面のパスキーセクションは auth しか触らない
    domains: {} as Services["domains"],
    uniqueness: {} as Services["uniqueness"],
    candidates: {} as Services["candidates"],
    subdomains: {} as Services["subdomains"],
    transfers: {} as Services["transfers"],
    logs: {} as Services["logs"],
    settings: {} as Services["settings"],
    payments: {} as Services["payments"],
  };
}

function renderSection(auth: AuthOverrides = {}) {
  const onNotify = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ServicesProvider services={createServices(auth)}>
        {children}
      </ServicesProvider>
    </QueryClientProvider>
  );

  render(<PasskeySection onNotify={onNotify} />, { wrapper });
  return { onNotify };
}

describe("PasskeySection", () => {
  it("読み込み中は骨組みを出し、取得できたら一覧に切り替わる", async () => {
    renderSection();

    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText("MacBook Touch ID")).not.toBeInTheDocument();

    expect(await screen.findByText("MacBook Touch ID")).toBeInTheDocument();
    expect(screen.getByText("iPhone Face ID")).toBeInTheDocument();
    // 作成日と最終利用（Figma S-70 の「作成 8/25 · 最終利用 …」）
    expect(screen.getByText(/^作成 8\/25 · 最終利用 /)).toBeInTheDocument();
    expect(screen.getByText("作成 8/25 · 未使用")).toBeInTheDocument();
  });

  it("取得に失敗したら Error Card と再試行を出す", async () => {
    renderSection({
      listPasskeys: () =>
        Promise.reject(
          new ApiClientError({
            code: "INTERNAL",
            message: "パスキーの一覧を取得できませんでした。",
          }),
        ),
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("INTERNAL");
    expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
  });

  it("0 件なら Empty State と追加ボタンを出す", async () => {
    renderSection({ listPasskeys: () => Promise.resolve([]) });

    expect(
      await screen.findByText("パスキーはまだありません"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "パスキーを追加" }),
    ).toBeInTheDocument();
  });

  it("最後の 1 つは削除ボタンを Disabled にする（D-09 を開かせない）", async () => {
    const only = PASSKEYS[0];
    if (only === undefined) throw new Error("fixture が壊れている");
    renderSection({ listPasskeys: () => Promise.resolve([only]) });

    // 見えるラベルは「削除」だけにして、押せない理由はアクセシブルネームにだけ残す
    const remove = await screen.findByRole("button", {
      name: "MacBook Touch ID のパスキーを削除（最後の 1 つは不可）",
    });
    expect(remove).toBeDisabled();
    expect(remove).toHaveTextContent(/^削除$/);
  });

  it("削除は D-09 を開いてから実行し、成功したら Banner Ok を親に渡す", async () => {
    const deletePasskey = vi.fn(() => Promise.resolve());
    const { onNotify } = renderSection({ deletePasskey });

    await user().click(
      await screen.findByRole("button", {
        name: "iPhone Face ID のパスキーを削除",
      }),
    );

    expect(
      await screen.findByText("パスキーを削除しますか？"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("iPhone Face ID のパスキーを削除します。"),
    ).toBeInTheDocument();

    await user().click(screen.getByRole("button", { name: "削除する" }));

    await waitFor(() => expect(deletePasskey).toHaveBeenCalledWith("pk_2"));
    await waitFor(() =>
      expect(onNotify).toHaveBeenCalledWith({
        kind: "banner",
        tone: "ok",
        title: "パスキーを削除しました",
        body: "iPhone Face ID を削除しました。",
      }),
    );
  });

  it("削除が 409 なら D-09 を閉じて Error Card を親に渡す（自分では出さない）", async () => {
    const error = new ApiClientError({
      code: "CONFLICT",
      message: "最後のパスキーは削除できません。",
    });
    const { onNotify } = renderSection({
      deletePasskey: () => Promise.reject(error),
    });

    await user().click(
      await screen.findByRole("button", {
        name: "iPhone Face ID のパスキーを削除",
      }),
    );
    await user().click(await screen.findByRole("button", { name: "削除する" }));

    await waitFor(() =>
      expect(onNotify).toHaveBeenCalledWith({ kind: "error", error }),
    );
    await waitFor(() =>
      expect(screen.queryByText("パスキーを削除しますか？")).toBeNull(),
    );
    // 警告の面が積み重ならないよう、セクション内には出さない
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("追加に失敗したら S-70b の Banner Warn を親に渡す", async () => {
    const { onNotify } = renderSection({
      addPasskey: () =>
        Promise.reject(
          new ApiClientError({
            code: "INTERNAL",
            message: "パスキーを登録できませんでした。",
          }),
        ),
    });

    await user().click(
      await screen.findByRole("button", { name: "パスキーを追加" }),
    );

    await waitFor(() =>
      expect(onNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: "warn",
          title: "パスキーを追加できませんでした",
        }),
      ),
    );
  });

  it("鉛筆ボタンでインライン編集になり、保存すると renamePasskey を呼んで一覧と Banner Ok に反映する", async () => {
    const passkeys = PASSKEYS.map((p) => ({ ...p }));
    const renamePasskey = vi.fn((id: string, name: string) => {
      const index = passkeys.findIndex((p) => p.id === id);
      const current = passkeys[index];
      if (current === undefined) throw new Error("fixture が壊れている");
      const renamed = { ...current, name };
      passkeys[index] = renamed;
      return Promise.resolve(renamed);
    });
    const { onNotify } = renderSection({
      listPasskeys: () => Promise.resolve([...passkeys]),
      renamePasskey,
    });

    await user().click(
      await screen.findByRole("button", {
        name: "iPhone Face ID の名前を変更",
      }),
    );
    const input = screen.getByRole("textbox", { name: "パスキーの名前" });
    expect(input).toHaveValue("iPhone Face ID");

    await user().clear(input);
    await user().type(input, "仕事用 iPhone");
    await user().click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(renamePasskey).toHaveBeenCalledWith("pk_2", "仕事用 iPhone"),
    );
    expect(await screen.findByText("仕事用 iPhone")).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "パスキーの名前" }),
    ).toBeNull();
    expect(onNotify).toHaveBeenCalledWith({
      kind: "banner",
      tone: "ok",
      title: "パスキーの名前を変更しました",
      body: "iPhone Face ID を 仕事用 iPhone に変更しました。",
    });
  });

  it("空・33 文字はクライアントで弾いて renamePasskey を呼ばない（Input の Helper を warn に）", async () => {
    const renamePasskey = vi.fn();
    renderSection({ renamePasskey });

    await user().click(
      await screen.findByRole("button", {
        name: "iPhone Face ID の名前を変更",
      }),
    );
    const input = screen.getByRole("textbox", { name: "パスキーの名前" });

    await user().clear(input);
    await user().click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText(PASSKEY_NAME_ERROR)).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");

    // 入力し直すとエラーは消え、Enter で再送しても 33 文字は弾かれる
    await user().type(input, "あ".repeat(33));
    expect(screen.queryByText(PASSKEY_NAME_ERROR)).toBeNull();
    await user().keyboard("{Enter}");
    expect(screen.getByText(PASSKEY_NAME_ERROR)).toBeInTheDocument();
    expect(renamePasskey).not.toHaveBeenCalled();
  });

  it("キャンセル / Escape で元の表示に戻り、renamePasskey を呼ばない", async () => {
    const renamePasskey = vi.fn();
    renderSection({ renamePasskey });

    await user().click(
      await screen.findByRole("button", {
        name: "iPhone Face ID の名前を変更",
      }),
    );
    await user().type(
      screen.getByRole("textbox", { name: "パスキーの名前" }),
      " 2",
    );
    await user().click(screen.getByRole("button", { name: "キャンセル" }));
    expect(
      screen.queryByRole("textbox", { name: "パスキーの名前" }),
    ).toBeNull();
    expect(screen.getByText("iPhone Face ID")).toBeInTheDocument();

    await user().click(
      screen.getByRole("button", { name: "iPhone Face ID の名前を変更" }),
    );
    await user().keyboard("{Escape}");
    expect(
      screen.queryByRole("textbox", { name: "パスキーの名前" }),
    ).toBeNull();
    expect(renamePasskey).not.toHaveBeenCalled();
  });

  it("変更に失敗したら編集中のまま Error Card を親に渡す", async () => {
    const error = new ApiClientError({
      code: "INTERNAL",
      message: "パスキーの名前を変更できませんでした。",
    });
    const { onNotify } = renderSection({
      renamePasskey: () => Promise.reject(error),
    });

    await user().click(
      await screen.findByRole("button", {
        name: "iPhone Face ID の名前を変更",
      }),
    );
    const input = screen.getByRole("textbox", { name: "パスキーの名前" });
    await user().clear(input);
    await user().type(input, "仕事用 iPhone");
    await user().click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(onNotify).toHaveBeenCalledWith({ kind: "error", error }),
    );
    // 直して再送できるよう編集中のまま
    expect(screen.getByRole("textbox", { name: "パスキーの名前" })).toHaveValue(
      "仕事用 iPhone",
    );
  });
});
