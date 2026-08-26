import { QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api/errors";
import {
  createMockServices,
  resetMockStore,
} from "@/lib/api/mock/mock-services";
import { ServicesProvider } from "@/lib/api/provider";
import { createQueryClient } from "@/lib/api/query-client";
import type { Services } from "@/lib/api/services";
import { SignedInRedirect } from "./signed-in-redirect";

/**
 * http モードの SignedInRedirect。`API_MODE` はビルド時定数なのでモジュールごと差し替える。
 * - セッション Cookie が有効（`GET /auth/me` 成功）なら sessionStorage の目印が無くても飛ぶ
 * - 401（未ログイン）は正常系: 飛ばないし、`/login?reason=expired` への誘導も起こさない
 *   （query-client.tsx の 401 ハンドラを `useMe({ probe: true })` の meta で抑止する）
 */

vi.mock("@/lib/api/mode", () => ({ API_MODE: "http" }));

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}));

function servicesWithMe(me: Services["settings"]["me"]): Services {
  const base = createMockServices("default", { delayMs: 0 });
  return { ...base, settings: { ...base.settings, me } };
}

function renderRedirect(services: Services) {
  const navigate = vi.fn();
  const queryClient = createQueryClient({
    redirectOnUnauthorized: true,
    navigate,
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ServicesProvider services={services}>
        <SignedInRedirect to="/dashboard" />
      </ServicesProvider>
    </QueryClientProvider>,
  );
  return { navigate };
}

beforeEach(() => {
  replace.mockClear();
  resetMockStore();
  window.sessionStorage.clear();
});

describe("SignedInRedirect（http）", () => {
  it("me が成功したら sessionStorage の目印が無くても to へ replace する", async () => {
    renderRedirect(createMockServices("default", { delayMs: 0 }));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("401（未ログイン）なら何もせず、/login?reason=expired への誘導も起こさない", async () => {
    const me = vi.fn(() =>
      Promise.reject(
        new ApiClientError({
          code: "UNAUTHORIZED",
          message: "ログインが必要です。",
        }),
      ),
    );
    const { navigate } = renderRedirect(servicesWithMe(me));

    await waitFor(() => {
      expect(me).toHaveBeenCalled();
    });
    // クエリの失敗が確定するまで待ってから、どちらの遷移も起きていないことを見る
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(replace).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
