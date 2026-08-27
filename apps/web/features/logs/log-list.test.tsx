import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api/errors";
import { LogList, type LogQuery } from "./log-list";

/**
 * S-62（0 件）/ S-63（読み込み・取得失敗）と「もっと見る」。
 * `?mock=empty` / `?mock=loading` / `?mock=error` はサービスの戻りを変えるだけなので、
 * ここでは `useQuery` の戻りを直接与えて 4 状態を突く。
 */

const ITEMS = ["a", "b", "c", "d", "e"];

function query(overrides: Partial<LogQuery<string>>): LogQuery<string> {
  return {
    data: undefined,
    isPending: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderList(value: LogQuery<string>) {
  render(
    <LogList
      listLabel="操作ログ"
      query={value}
      renderRow={(item) => <li key={item}>{item}</li>}
    />,
  );
}

describe("LogList", () => {
  it("読み込み中は Skeleton 行を 6 本出す（S-63）", () => {
    renderList(query({ isPending: true }));

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".animate-pulse")).toHaveLength(6);
  });

  it("取得失敗は Banner Warn と再試行を出す（S-63）", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    renderList(
      query({
        error: new ApiClientError({
          code: "INTERNAL",
          message: "操作ログを取得できませんでした。",
        }),
        refetch,
      }),
    );

    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("エラーが発生しました");
    await user.click(screen.getByRole("button", { name: "再試行" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("再試行しても意味の無いエラーには再試行を出さない", () => {
    renderList(
      query({
        error: new ApiClientError({
          code: "NOT_IMPLEMENTED",
          message: "GET /logs/operations はまだ実装されていません。",
        }),
      }),
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "再試行" }),
    ).not.toBeInTheDocument();
  });

  it("再取得に失敗しても取得済みの行は残す（ui-screens §4 参照系エラー）", () => {
    renderList(
      query({
        data: ITEMS,
        error: new ApiClientError({
          code: "REGISTRY_UNAVAILABLE",
          message: "Kitaqsign に接続できません。",
          registry: "kitaqsign",
        }),
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Kitaqsign に接続できません",
    );
    expect(
      screen.getByRole("list", { name: "操作ログ" }).children,
    ).toHaveLength(3);
    expect(
      screen.getByRole("button", { name: "もっと見る（残 2 件）" }),
    ).toBeInTheDocument();
  });

  it("0 件は Empty State を出す（S-62）", () => {
    renderList(query({ data: [] }));

    expect(screen.getByText("ログはまだありません")).toBeInTheDocument();
    expect(
      screen.getByText(
        "レジストリへの操作（登録・更新・移管など）と AI 呼び出しが、成功・失敗を問わずここに記録されます。",
      ),
    ).toBeInTheDocument();
  });

  it("1 ページ分だけ出し、「もっと見る」で残りを足す", async () => {
    const user = userEvent.setup();
    renderList(query({ data: ITEMS }));

    const list = screen.getByRole("list", { name: "操作ログ" });
    expect(list.children).toHaveLength(3);

    await user.click(
      screen.getByRole("button", { name: "もっと見る（残 2 件）" }),
    );

    expect(
      screen.getByRole("list", { name: "操作ログ" }).children,
    ).toHaveLength(5);
    expect(screen.queryByText(/もっと見る/)).not.toBeInTheDocument();
  });
});
