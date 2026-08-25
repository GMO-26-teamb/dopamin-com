import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_NOW } from "@/lib/api/mock/fixtures";
import type { Transfer } from "@/lib/api/types";
import { TransferItem, transferKind } from "./transfer-item";

/**
 * 残り時間は `Date.now()` から計算するので、時計を fixtures の基準時刻に固定する。
 * `toFake: ["Date"]` なので `setTimeout` は本物のまま = Testing Library / user-event は
 * 実タイマーで動く。これで `14:32` の表示が実行時刻に左右されない。
 */
const REMAINING_MS = (14 * 60 + 32) * 1000;

function inFuture(): string {
  return new Date(Date.now() + REMAINING_MS).toISOString();
}

function transfer(overrides: Partial<Transfer> = {}): Transfer {
  return {
    id: "trf_001",
    domainName: "tkt-lab.net",
    registry: "kitaqsign",
    direction: "in",
    status: "pending",
    requestedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    actByAt: inFuture(),
    completedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(MOCK_NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("transferKind", () => {
  it("direction × status から 4 つの Kind を導出する", () => {
    expect(
      transferKind(transfer({ direction: "out", status: "pending" })),
    ).toBe("out-received");
    expect(transferKind(transfer({ direction: "in", status: "pending" }))).toBe(
      "in-pending",
    );
    expect(transferKind(transfer({ status: "import_pending" }))).toBe(
      "import-pending",
    );
    for (const status of ["approved", "rejected", "cancelled"] as const) {
      expect(transferKind(transfer({ status }))).toBe("history");
    }
  });
});

describe("TransferItem", () => {
  it("Out Received: OUT バッジ・残り時間・承認 / 拒否を出す", () => {
    render(
      <TransferItem
        transfer={transfer({
          direction: "out",
          domainName: "harupika.xyz",
          status: "pending",
        })}
      />,
    );

    expect(screen.getByText("OUT")).toBeInTheDocument();
    expect(
      screen.getByText(
        "移管申請を受信 — 承認しないと 14:32 後に自動承認されます",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "harupika.xyz の移管を承認" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "harupika.xyz の移管を拒否" }),
    ).toBeEnabled();
  });

  it("In Pending: IN バッジ・自動承認までの残り時間・状態を確認 / 取消を出す", async () => {
    const onCancel = vi.fn();
    render(<TransferItem onCancel={onCancel} transfer={transfer()} />);

    expect(screen.getByText("IN")).toBeInTheDocument();
    expect(
      screen.getByText(
        "申請中 — 相手レジストラの承認待ち（自動承認まで 14:32）",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "tkt-lab.net の状態を確認" }),
    ).toBeEnabled();

    await userEvent
      .setup()
      .click(
        screen.getByRole("button", { name: "tkt-lab.net の移管申請を取消" }),
      );
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Import Pending: 取り込み待ちと再試行を出す", () => {
    render(
      <TransferItem
        transfer={transfer({ actByAt: null, status: "import_pending" })}
      />,
    );

    expect(
      screen.getByText(
        "承認済み — 取り込み待ち。「再試行」で取り込みを実行します",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "tkt-lab.net の取り込みを再試行" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /取消/ })).toBeNull();
  });

  it("History: 完了日と詳細リンクを出し、操作ボタンは出さない", () => {
    render(
      <TransferItem
        transfer={transfer({
          actByAt: null,
          completedAt: "2026-08-20T12:00:00+09:00",
          direction: "out",
          domainName: "old-blog.xyz",
          status: "approved",
        })}
      />,
    );

    expect(
      screen.getByText(/^完了 — \d{2}-\d{2} に移管 OUT$/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "old-blog.xyz" })).toHaveAttribute(
      "href",
      "/domains/old-blog.xyz",
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("自動承認の期限を過ぎたら承認 / 拒否を Disabled にする", () => {
    render(
      <TransferItem
        transfer={transfer({
          actByAt: new Date(Date.now() - 1000).toISOString(),
          direction: "out",
          status: "pending",
        })}
      />,
    );

    expect(
      screen.getByText("自動承認の期限を過ぎました — 状態を確認してください"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "tkt-lab.net の移管を承認" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "tkt-lab.net の移管を拒否" }),
    ).toBeDisabled();
    // 再照会だけは残す
    expect(
      screen.getByRole("button", { name: "tkt-lab.net の状態を確認" }),
    ).toBeEnabled();
  });

  it("busy（操作中）は行の操作をすべて止める", () => {
    render(<TransferItem busy transfer={transfer()} />);

    expect(
      screen.getByRole("button", { name: "tkt-lab.net の移管申請を取消" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "tkt-lab.net の状態を確認" }),
    ).toBeDisabled();
  });

  it("updateFailed（S-53）は取消だけ止め、「状態を確認」は残す（spec S-53）", () => {
    render(<TransferItem transfer={transfer()} updateFailed />);

    expect(
      screen.getByRole("button", { name: "tkt-lab.net の移管申請を取消" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "tkt-lab.net の状態を確認" }),
    ).toBeEnabled();
  });
});
