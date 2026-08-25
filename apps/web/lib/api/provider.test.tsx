import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { queryKeys, useDomains } from "./hooks";
import { resetMockStore } from "./mock/mock-services";
import { AppProviders } from "./query-client";

/** `useDomains()` の `loading | error | ready` をそのまま文字列に落とすだけの画面。 */
function DomainsProbe() {
  const { isPending, error, data } = useDomains();
  if (isPending) {
    return <p>loading</p>;
  }
  if (error) {
    return <p>error: {error.code}</p>;
  }
  return <p>domains: {data.length}</p>;
}

function renderAt(url: string) {
  window.history.replaceState({}, "", url);
  return render(
    <AppProviders>
      <DomainsProbe />
    </AppProviders>,
  );
}

beforeEach(() => {
  resetMockStore();
  window.history.replaceState({}, "", "/dashboard");
});

describe("queryKeys", () => {
  it("先頭にスコープが入る（シナリオごとにキャッシュを分ける）", () => {
    expect(queryKeys("error").domains()).toEqual(["error", "domains"]);
    expect(queryKeys("http").domain("takutaku.com")).toEqual([
      "http",
      "domain",
      "takutaku.com",
    ]);
    expect(queryKeys("default").domains()).not.toEqual(
      queryKeys("error").domains(),
    );
  });
});

describe("ServicesProvider - ?mock=<scenario>", () => {
  it("?mock=error はエラー状態になる（既定シナリオの結果を掴まない）", async () => {
    renderAt("/dashboard?mock=error");

    // 参照系は retryable なエラーを 2 回まで自動再試行する（query-client.tsx）
    await waitFor(
      () => {
        expect(
          screen.getByText("error: REGISTRY_UNAVAILABLE"),
        ).toBeInTheDocument();
      },
      { timeout: 15_000 },
    );
  }, 20_000);

  it("?mock=empty は空一覧になる", async () => {
    renderAt("/dashboard?mock=empty");

    await waitFor(() => {
      expect(screen.getByText("domains: 0")).toBeInTheDocument();
    });
  });

  it("?mock= 無しは fixtures の 4 件", async () => {
    renderAt("/dashboard");

    await waitFor(() => {
      expect(screen.getByText("domains: 4")).toBeInTheDocument();
    });
  });

  it("マウント後にシナリオが変わったら取り直す（クライアント遷移）", async () => {
    renderAt("/dashboard");
    await waitFor(() => {
      expect(screen.getByText("domains: 4")).toBeInTheDocument();
    });

    // App Router のクライアント遷移と同じく pushState で URL だけ変える
    act(() => {
      window.history.pushState({}, "", "/dashboard?mock=empty");
    });

    await waitFor(() => {
      expect(screen.getByText("domains: 0")).toBeInTheDocument();
    });
  });
});
