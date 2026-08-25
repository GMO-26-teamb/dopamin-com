import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api/errors";
import { resetMockStore } from "@/lib/api/mock/mock-services";
import { AppProviders } from "@/lib/api/query-client";
import type { AuthService } from "@/lib/api/services";
import { LoginScreen } from "./login-screen";
import { startAuthSession } from "./session";
import { servicesWithAuth } from "./test-services";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}));

function renderLogin(
  overrides: Partial<AuthService> = {},
  props: { next?: string | null; expired?: boolean } = {},
) {
  render(
    <AppProviders services={servicesWithAuth(overrides)}>
      <LoginScreen expired={props.expired ?? false} next={props.next ?? null} />
    </AppProviders>,
  );
}

beforeEach(() => {
  replace.mockClear();
  resetMockStore();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/login");
});

describe("LoginScreen", () => {
  it("S-02: テキスト入力欄を置かずボタン 1 つ（AC-01-2）", async () => {
    renderLogin();

    expect(
      await screen.findByRole("button", { name: "パスキーでログイン" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "新規登録" })).toHaveAttribute(
      "href",
      "/signup",
    );
  });

  it("S-02: 成功したら ?next= へ戻る（AC-01-3）", async () => {
    renderLogin({}, { next: "/domains/takutaku.com" });

    await userEvent.click(
      await screen.findByRole("button", { name: "パスキーでログイン" }),
    );

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/domains/takutaku.com");
    });
  });

  it("S-02: next が外部 URL なら /dashboard に落とす", async () => {
    renderLogin({}, { next: "https://evil.example" });

    await userEvent.click(
      await screen.findByRole("button", { name: "パスキーでログイン" }),
    );

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("S-02b: 失敗すると Banner Warn を出して再試行できる", async () => {
    renderLogin({
      login: () =>
        Promise.reject(
          new ApiClientError({ code: "UNAUTHORIZED", message: "だめでした" }),
        ),
    });

    await userEvent.click(
      await screen.findByRole("button", { name: "パスキーでログイン" }),
    );

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("ログインできませんでした");
    expect(replace).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "パスキーでログイン" }),
    ).toBeEnabled();
  });

  it("S-02c: 非対応環境ではボタンを出さず Empty State Warn だけ（AC-01-5）", async () => {
    renderLogin({ isSupported: () => false });

    expect(
      await screen.findByText("このブラウザはパスキーに対応していません"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "パスキーでログイン" }),
    ).not.toBeInTheDocument();
  });

  it("S-03: ?reason=expired で Banner Info と戻り先を出す", async () => {
    renderLogin({}, { expired: true, next: "/dashboard" });

    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent("セッションの有効期限が切れました");
    expect(banner).toHaveTextContent("元のページ（/dashboard）に戻ります");
  });

  it("S-03 と S-02b が重なったら失敗のバナーを優先する（バナーは 1 つ）", async () => {
    renderLogin(
      {
        login: () =>
          Promise.reject(
            new ApiClientError({ code: "UNAUTHORIZED", message: "だめでした" }),
          ),
      },
      { expired: true },
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "パスキーでログイン" }),
    );

    expect(
      await screen.findByText("ログインできませんでした"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("セッションの有効期限が切れました"),
    ).not.toBeInTheDocument();
  });

  it("ログイン済み（このタブでログイン済み）なら /dashboard へ送る", async () => {
    startAuthSession();
    renderLogin();

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/dashboard");
    });
  });
});
