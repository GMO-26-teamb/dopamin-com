import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api/errors";
import { resetMockStore } from "@/lib/api/mock/mock-services";
import { AppProviders } from "@/lib/api/query-client";
import type { AuthService } from "@/lib/api/services";
import { SignupScreen } from "./signup-screen";
import { servicesWithAuth } from "./test-services";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}));

function renderSignup(
  overrides: Partial<AuthService> = {},
  next: string | null = null,
) {
  render(
    <AppProviders services={servicesWithAuth(overrides)}>
      <SignupScreen next={next} />
    </AppProviders>,
  );
}

beforeEach(() => {
  replace.mockClear();
  resetMockStore();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/signup");
});

describe("SignupScreen", () => {
  it("S-01: 表示名 1 つと作成ボタン、ログインへの導線", async () => {
    renderSignup();

    expect(
      await screen.findByLabelText("表示名（1〜32文字）"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "パスキーを作成する" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "パスキーでログイン" }),
    ).toHaveAttribute("href", "/login");
  });

  it("S-01: 成功したら ?next= を引き継いで遷移する", async () => {
    renderSignup({}, "/domains/new");

    await userEvent.type(
      await screen.findByLabelText("表示名（1〜32文字）"),
      "たくたく",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "パスキーを作成する" }),
    );

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/domains/new");
    });
  });

  it("?next= はログイン画面へのリンクにも引き継ぐ", async () => {
    renderSignup({}, "/transfers");

    expect(
      await screen.findByRole("link", { name: "パスキーでログイン" }),
    ).toHaveAttribute("href", "/login?next=%2Ftransfers");
  });

  it("空の表示名はクライアントで弾き、API を呼ばない", async () => {
    const signup = vi.fn();
    renderSignup({ signup });

    await userEvent.click(
      await screen.findByRole("button", { name: "パスキーを作成する" }),
    );

    expect(
      await screen.findByText("表示名は 1〜32 文字で入力してください。"),
    ).toBeInTheDocument();
    expect(signup).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("S-01b: 作成に失敗すると Banner Warn を出して再試行できる", async () => {
    renderSignup({
      signup: () =>
        Promise.reject(
          new ApiClientError({ code: "INTERNAL", message: "だめでした" }),
        ),
    });

    await userEvent.type(
      await screen.findByLabelText("表示名（1〜32文字）"),
      "たくたく",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "パスキーを作成する" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "パスキーを作成できませんでした",
    );
    expect(
      screen.getByRole("button", { name: "パスキーを作成する" }),
    ).toBeEnabled();
  });

  it("サーバーの VALIDATION_ERROR は Input の Helper に出す（バナーではない）", async () => {
    renderSignup({
      signup: () =>
        Promise.reject(
          new ApiClientError({
            code: "VALIDATION_ERROR",
            message: "表示名が長すぎます",
          }),
        ),
    });

    const input = await screen.findByLabelText("表示名（1〜32文字）");
    await userEvent.type(input, "たくたく");
    await userEvent.click(
      screen.getByRole("button", { name: "パスキーを作成する" }),
    );

    await waitFor(() => {
      expect(input).toHaveAttribute("aria-invalid", "true");
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("S-01c: 非対応環境ではフォームを出さず Empty State Warn だけ（AC-01-5）", async () => {
    renderSignup({ isSupported: () => false });

    expect(
      await screen.findByText("このブラウザはパスキーに対応していません"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
