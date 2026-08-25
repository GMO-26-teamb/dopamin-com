import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DnsDiff, SubdomainHost } from "@/lib/api/types";
import { ApplyDnsDialog } from "./apply-dns-dialog";

function host(
  overrides: Partial<SubdomainHost> & { host: string },
): SubdomainHost {
  return {
    applyStatus: "pending",
    id: overrides.host,
    priority: "recommended",
    purpose: "",
    recordType: "CNAME",
    target: `${overrides.host}.example-app.com`,
    ...overrides,
  };
}

/** takutaku.com の fixture と同じ形（追加 1 / 変更 1 / 削除 0 / 変更なし 2）。 */
const DIFF: DnsDiff = {
  added: [
    host({
      host: "status",
      priority: "optional",
      recordType: "A",
      target: "203.0.113.20",
    }),
  ],
  updated: [
    {
      host: host({
        applyStatus: "changed",
        host: "docs",
        target: "docs.example-app.com",
      }),
      previous: {
        host: "docs",
        recordType: "CNAME",
        target: "docs-old.example-app.com",
        ttl: 300,
      },
    },
  ],
  removed: [],
  unchanged: ["www", "api"],
};

function renderDialog(
  overrides: Partial<Parameters<typeof ApplyDnsDialog>[0]> = {},
) {
  const onApply = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ApplyDnsDialog
      applying={false}
      diff={DIFF}
      domain="takutaku.com"
      error={null}
      loading={false}
      nameserversSwitched={false}
      onApply={onApply}
      onOpenChange={onOpenChange}
      open
      {...overrides}
    />,
  );
  return { onApply, onOpenChange };
}

describe("ApplyDnsDialog（S-44）", () => {
  it("追加 / 変更 / 削除の件数チップと変更なしの内訳を出す（AC-13-7）", () => {
    renderDialog();

    expect(screen.getByText("追加 1")).toBeInTheDocument();
    expect(screen.getByText("変更 1")).toBeInTheDocument();
    expect(screen.getByText("削除 0")).toBeInTheDocument();
    expect(screen.getByText("変更なし 2（www・api）")).toBeInTheDocument();
  });

  it("対象ホストを差分行に出し、変更は旧値も添える", () => {
    renderDialog();

    expect(screen.getByText("status")).toBeInTheDocument();
    expect(screen.getByText("A 203.0.113.20")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("CNAME docs.example-app.com.")).toBeInTheDocument();
    expect(
      screen.getByText("旧: CNAME docs-old.example-app.com."),
    ).toBeInTheDocument();
  });

  it("主要ボタンは差分の合計件数を出し、押すと反映する", async () => {
    const { onApply } = renderDialog();

    const button = screen.getByRole("button", { name: "2 件を反映する" });
    await userEvent.setup().click(button);

    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("NS が未切替なら Warn バッジで「反映時に切り替えます」と伝える（AC-13-5）", () => {
    renderDialog();

    expect(
      screen.getByText("未切替 — 反映時に切り替えます"),
    ).toBeInTheDocument();
  });

  it("NS 切替済みなら Ok バッジになる", () => {
    renderDialog({ nameserversSwitched: true });

    expect(screen.getByText("ドパ民 DNS に切替済み")).toBeInTheDocument();
  });

  it("差分が 0 件なら反映ボタンを押せない", () => {
    renderDialog({
      diff: { added: [], updated: [], removed: [], unchanged: ["www"] },
    });

    expect(
      screen.getByRole("button", { name: "0 件を反映する" }),
    ).toBeDisabled();
  });

  it("キャンセルでダイアログを閉じる（何も変更しない）", async () => {
    const { onApply, onOpenChange } = renderDialog();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "キャンセル" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onApply).not.toHaveBeenCalled();
  });
});
