import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api/errors";
import {
  createMockServices,
  resetMockStore,
} from "@/lib/api/mock/mock-services";
import { ServicesProvider } from "@/lib/api/provider";
import type { Services } from "@/lib/api/services";
import { startAuthSession } from "./session";
import { SignedInRedirect } from "./signed-in-redirect";

/**
 * モックモード（テスト環境の既定 `API_MODE = "mock"`）の SignedInRedirect。
 * `me` が成功するだけでは飛ばず、「このタブでモックログインした」目印があるときだけ飛ぶ
 * （S-00 / S-01 / S-02 をモックで確認できるようにするため。session.ts 参照）。
 */

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}));

function servicesWithMe(me: Services["settings"]["me"]): Services {
  const base = createMockServices("default", { delayMs: 0 });
  return { ...base, settings: { ...base.settings, me } };
}

function renderRedirect(services: Services, to?: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ServicesProvider services={services}>
        <SignedInRedirect to={to} />
      </ServicesProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  replace.mockClear();
  resetMockStore();
  window.sessionStorage.clear();
});

describe("SignedInRedirect（mock）", () => {
  it("me が成功し、このタブでログイン済みなら to へ replace する", async () => {
    startAuthSession();
    renderRedirect(createMockServices("default", { delayMs: 0 }), "/domains");

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/domains");
    });
  });

  it("to を省略したら /dashboard（DEFAULT_NEXT_PATH）", async () => {
    startAuthSession();
    renderRedirect(createMockServices("default", { delayMs: 0 }));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("ログイン済みの目印が無ければ me が成功しても飛ばない", async () => {
    const me = vi.fn(async () =>
      createMockServices("default", { delayMs: 0 }).settings.me(),
    );
    renderRedirect(servicesWithMe(me));

    await waitFor(() => {
      expect(me).toHaveBeenCalled();
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it("me が 401 なら目印があっても飛ばない", async () => {
    startAuthSession();
    const me = vi.fn(() =>
      Promise.reject(
        new ApiClientError({ code: "UNAUTHORIZED", message: "未ログイン" }),
      ),
    );
    renderRedirect(servicesWithMe(me));

    await waitFor(() => {
      expect(me).toHaveBeenCalled();
    });
    expect(replace).not.toHaveBeenCalled();
  });
});
