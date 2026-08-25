import { deriveDisplayStatus } from "@dopamin/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DomainSummary } from "@/lib/api/types";
import { DomainCard, deriveCardStatus } from "./domain-card";

/** fixtures と同じ固定基準（apps/web/lib/api/mock/fixtures.ts の MOCK_NOW）。 */
const NOW = new Date("2026-08-26T10:00:00+09:00");
const DAY_MS = 24 * 60 * 60 * 1000;

function at(offsetDays: number): string {
  return new Date(NOW.getTime() + offsetDays * DAY_MS).toISOString();
}

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

type DomainOverrides = Partial<Omit<DomainSummary, "displayStatus">>;

/** `displayStatus` は必ず deriveDisplayStatus から作る（UI では再解釈しない）。 */
function makeDomain(overrides: DomainOverrides = {}): DomainSummary {
  const base = {
    name: "takutaku.com",
    sld: "takutaku",
    tld: "com",
    registry: "kitaqsign" as const,
    statuses: ["ok"],
    rgpStatuses: [] as string[],
    ownership: "owned" as const,
    registeredAt: at(-400),
    expiresAt: at(330) as string | null,
    rgpUntil: null as string | null,
    syncedAt: minutesAgo(3),
    stale: false,
    transfer: null as DomainSummary["transfer"],
    ...overrides,
  };
  return {
    ...base,
    displayStatus: deriveDisplayStatus({
      statuses: base.statuses,
      rgpStatuses: base.rgpStatuses,
      ownership: base.ownership,
      transfer: base.transfer,
    }),
  };
}

function renderCard(
  overrides: DomainOverrides = {},
  props: Partial<Parameters<typeof DomainCard>[0]> = {},
) {
  const domain = makeDomain(overrides);
  render(<DomainCard domain={domain} now={NOW} {...props} />);
  return domain;
}

describe("deriveCardStatus", () => {
  it("active は残り 30 日以内で Expiring に落ちる（AC-02-2）", () => {
    expect(deriveCardStatus(makeDomain({ expiresAt: at(31) }), NOW)).toBe(
      "active",
    );
    expect(deriveCardStatus(makeDomain({ expiresAt: at(30) }), NOW)).toBe(
      "expiring",
    );
    expect(deriveCardStatus(makeDomain({ expiresAt: at(1) }), NOW)).toBe(
      "expiring",
    );
  });

  it("有効期限が無いドメインは Expiring にしない", () => {
    expect(deriveCardStatus(makeDomain({ expiresAt: null }), NOW)).toBe(
      "active",
    );
  });

  it("移管申請は向きに関わらず Transferring", () => {
    const incoming = makeDomain({
      statuses: ["ok", "pendingTransfer"],
      transfer: { direction: "in", actByAt: at(1) },
    });
    const outgoing = makeDomain({
      statuses: ["ok", "pendingTransfer"],
      transfer: { direction: "out", actByAt: at(1) },
    });
    expect(deriveCardStatus(incoming, NOW)).toBe("transferring");
    expect(deriveCardStatus(outgoing, NOW)).toBe("transferring");
  });
});

describe("DomainCard の 8 ステータス（ui-screens §2.2）", () => {
  it("Active: Active バッジ + 進捗 + 更新 / 詳細", () => {
    renderCard();

    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "更新" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "詳細" })).toHaveAttribute(
      "href",
      "/domains/takutaku.com",
    );
    expect(screen.getByText("Kitaqsign")).toBeInTheDocument();
  });

  it("Expiring: 残日数バッジ（Warn）+ 今すぐ更新", () => {
    renderCard({ name: "harupika.xyz", expiresAt: at(23), tld: "xyz" });

    // 残日数はバッジだけが持つ（Meta 側は期限日のみ）ので getByText が一意に取れる
    expect(screen.getByText("残23日")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "今すぐ更新" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/^\d{4}-\d{2}-\d{2}$/)).toBeInTheDocument();
  });

  it("Redeemable: 復旧猶予の残日数 + 復旧する", () => {
    renderCard({
      name: "demo-app.online",
      rgpStatuses: ["redemptionPeriod"],
      expiresAt: at(-45),
      rgpUntil: at(18),
    });

    expect(screen.getByText("復旧猶予 残18日")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "復旧する" })).toBeInTheDocument();
    expect(screen.getByText("廃止済み — 復旧可能")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("Transferring: 移管申請中 + 状態を確認（/transfers へ）。詳細は出さない", () => {
    renderCard({
      name: "tkt-lab.net",
      statuses: ["ok", "pendingTransfer"],
      transfer: { direction: "out", actByAt: at(1) },
    });

    expect(screen.getByText("移管申請中")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "状態を確認" })).toHaveAttribute(
      "href",
      "/transfers?domain=tkt-lab.net",
    );
    expect(
      screen.queryByRole("link", { name: "詳細" }),
    ).not.toBeInTheDocument();
  });

  it("Hold: 停止中 + 情報修正", () => {
    renderCard({ statuses: ["ok", "clientHold"] });

    expect(screen.getByText("停止中")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "情報修正" })).toBeInTheDocument();
  });

  it("Inactive: NS 未設定 + NS を設定", () => {
    renderCard({ statuses: ["inactive"] });

    expect(screen.getByText("NS 未設定")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "NS を設定" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("PendingDelete: 削除待ち + 詳細のみ", () => {
    renderCard({
      statuses: ["pendingDelete"],
      rgpStatuses: ["pendingDelete"],
      rgpUntil: at(4),
    });

    expect(screen.getByText("削除待ち")).toBeInTheDocument();
    expect(screen.getByText("完全削除まで 残4日")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "詳細" })).toHaveAttribute(
      "href",
      "/domains/takutaku.com",
    );
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("Locked: ロック種別のバッジ + 更新", () => {
    renderCard({
      statuses: ["ok", "clientTransferProhibited", "clientDeleteProhibited"],
    });

    expect(screen.getByText("移管ロック")).toBeInTheDocument();
    // 更新はロックされていないので押せる
    expect(screen.getByRole("link", { name: "更新" })).toBeInTheDocument();
  });
});

describe("DomainCard の操作", () => {
  it("更新ロック中は主操作を Disabled にして理由を読み上げる（AC-07-1）", () => {
    renderCard({ statuses: ["ok", "clientRenewProhibited"] });

    expect(screen.getByText("更新ロック")).toBeInTheDocument();
    const renew = screen.getByRole("button", { name: "更新" });
    expect(renew).toBeDisabled();
    expect(
      screen.getByText("clientRenewProhibited のため実行できません。"),
    ).toBeInTheDocument();
    expect(renew).toHaveAttribute(
      "aria-describedby",
      screen.getByText("clientRenewProhibited のため実行できません。").id,
    );
  });

  it("Stale のカードは Stale バッジ + 最終同期を出し、更新系を Disabled にする（S-13）", () => {
    renderCard({ stale: true, syncedAt: minutesAgo(42) });

    expect(screen.getByText("未同期")).toBeInTheDocument();
    expect(screen.getByText("最終同期 42分前")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新" })).toBeDisabled();
    // 参照系（詳細）は塞がない
    expect(screen.getByRole("link", { name: "詳細" })).toBeInTheDocument();
  });

  it("onRenew を渡すとダイアログ用のコールバックが呼ばれる", async () => {
    const user = userEvent.setup();
    const onRenew = vi.fn();
    const domain = renderCard({}, { onRenew });

    await user.click(screen.getByRole("button", { name: "更新" }));

    expect(onRenew).toHaveBeenCalledWith(domain);
  });

  it("コールバックが無いときは詳細画面へ送る", () => {
    renderCard({ statuses: ["inactive"] });

    expect(screen.getByRole("link", { name: "NS を設定" })).toHaveAttribute(
      "href",
      "/domains/takutaku.com",
    );
  });
});
