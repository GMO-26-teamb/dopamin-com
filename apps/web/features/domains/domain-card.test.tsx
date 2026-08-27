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

/** カード面そのもののリンク（stretched link）。名前はドメイン名 + 「の詳細」。 */
function cardLink(name = "takutaku.com") {
  return screen.getByRole("link", { name: `${name} の詳細` });
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

describe("カード面が詳細へのリンクになる（#216）", () => {
  it("カード全体が詳細へのリンクで、別途「詳細」ボタンは出さない", () => {
    renderCard();

    expect(cardLink()).toHaveAttribute("href", "/domains/takutaku.com");
    expect(
      screen.queryByRole("link", { name: "詳細" }),
    ).not.toBeInTheDocument();
  });

  it("カード面のリンクはカード全体を覆う（どこを押しても詳細へ行く）", () => {
    renderCard();

    // stretched link: article（relative）いっぱいに敷いた <a>
    expect(cardLink()).toHaveClass("absolute", "inset-0");
  });

  it("Tab はカード面のリンク → 主操作の順に進み、Enter で詳細へ行ける", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.tab();
    const link = cardLink();
    expect(link).toHaveFocus();

    // フォーカスしたリンクを Enter で起動できる（= キーボードだけで詳細に到達できる）
    const activated = vi.fn((event: Event) => {
      event.preventDefault();
    });
    link.addEventListener("click", activated);
    await user.keyboard("{Enter}");
    expect(activated).toHaveBeenCalled();

    await user.tab();
    expect(screen.getByRole("link", { name: "更新" })).toHaveFocus();
  });

  it("状態バッジ横の HelpTip は出さない（意味は Meta が持つ）", () => {
    renderCard();

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("DomainCard の 8 ステータス（ui-screens §2.2）", () => {
  it("Active: Active バッジ + 進捗 + 更新。残日数は Meta に出す", () => {
    renderCard();

    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "更新" })).toBeInTheDocument();
    expect(
      screen.getByText(/^\d{4}-\d{2}-\d{2} · 残330日$/),
    ).toBeInTheDocument();
    expect(screen.getByText("Kitaqsign")).toBeInTheDocument();
  });

  it("Expiring: バッジは状態名だけ（Warn）で、残日数は Meta 側に出す", () => {
    renderCard({ name: "harupika.xyz", expiresAt: at(23), tld: "xyz" });

    expect(screen.getByText("まもなく期限")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "今すぐ更新" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/^\d{4}-\d{2}-\d{2} · 残23日$/),
    ).toBeInTheDocument();
  });

  it("Redeemable: バッジは状態名、Meta は次にできること + 残日数（AC-10-1）", () => {
    renderCard({
      name: "demo-app.online",
      // RGP 中は EPP 仕様上 pendingDelete が共存する（mock の形・#171）
      statuses: ["pendingDelete"],
      rgpStatuses: ["redemptionPeriod"],
      expiresAt: at(-45),
      rgpUntil: at(18),
    });

    expect(screen.getByText("復旧猶予")).toBeInTheDocument();
    expect(screen.getByText("復旧できます · 残18日")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "復旧する" })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("Redeemable: 実レジストリ形（statuses 側に redemptionPeriod）でも同じ（#171）", () => {
    renderCard({
      name: "demo-app.online",
      statuses: ["pendingDelete", "redemptionPeriod"],
      rgpStatuses: [],
      expiresAt: at(-45),
      rgpUntil: at(18),
    });

    expect(screen.getByText("復旧猶予")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "復旧する" })).toBeInTheDocument();
  });

  it("Transferring: 移管申請中 + 状態を確認（/transfers へ）", () => {
    renderCard({
      name: "tkt-lab.net",
      statuses: ["ok", "pendingTransfer"],
      transfer: { direction: "out", actByAt: at(1) },
    });

    expect(screen.getByText("移管申請中")).toBeInTheDocument();
    expect(screen.getByText("完了するまで変更できません")).toBeInTheDocument();
    // 宛先がカード面（詳細）と違うので、この導線だけはボタンとして残す
    expect(screen.getByRole("link", { name: "状態を確認" })).toHaveAttribute(
      "href",
      "/transfers?domain=tkt-lab.net",
    );
    expect(cardLink("tkt-lab.net")).toHaveAttribute(
      "href",
      "/domains/tkt-lab.net",
    );
  });

  it("Hold: 停止中 + 情報修正", () => {
    renderCard({ statuses: ["ok", "clientHold"] });

    expect(screen.getByText("停止中")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "情報修正" })).toBeInTheDocument();
  });

  it("Inactive: NS 未設定 + 何が起きているかを Meta に足す", () => {
    renderCard({ statuses: ["inactive"] });

    expect(screen.getByText("NS 未設定")).toBeInTheDocument();
    expect(
      screen.getByText(/^つながりません · \d{4}-\d{2}-\d{2}$/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "NS を設定" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("PendingDelete: 削除待ち。できる操作が無いのでボタンは出さない", () => {
    renderCard({
      statuses: ["pendingDelete"],
      rgpStatuses: ["pendingDelete"],
      rgpUntil: at(4),
    });

    expect(screen.getByText("削除待ち")).toBeInTheDocument();
    expect(screen.getByText("完全削除まで · 残4日")).toBeInTheDocument();
    // 残るリンクはカード面の 1 本だけ
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(cardLink()).toHaveAttribute("href", "/domains/takutaku.com");
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
  it("更新ロック中は主操作を Disabled にし、理由を目に見える形で出す（AC-07-1）", () => {
    renderCard({ statuses: ["ok", "clientRenewProhibited"] });

    expect(screen.getByText("更新ロック")).toBeInTheDocument();
    const renew = screen.getByRole("button", { name: "更新" });
    expect(renew).toBeDisabled();

    const note = screen.getByText("詳細画面でロックを外すと操作できます。");
    // sr-only に隠さない（目で見ているユーザーにも理由が届く）
    expect(note).not.toHaveClass("sr-only");
    expect(renew).toHaveAttribute("aria-describedby", note.id);
  });

  it("レジストリ側のロックは自分で外せないと分かる文言にする", () => {
    renderCard({ statuses: ["ok", "serverRenewProhibited"] });

    expect(
      screen.getByText("レジストリ側で止まっているため操作できません。"),
    ).toBeInTheDocument();
  });

  it("Stale のカードは未同期バッジ + 最終同期 + 押せない理由を出す（S-13）", () => {
    renderCard({ stale: true, syncedAt: minutesAgo(42) });

    expect(screen.getByText("未同期")).toBeInTheDocument();
    expect(screen.getByText("最終同期 42分前")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新" })).toBeDisabled();

    const note = screen.getByText("「最新化」を押すと操作できます。");
    expect(note).not.toHaveClass("sr-only");
    // 詳細を開く導線は stale でも塞がない
    expect(cardLink()).toHaveAttribute("href", "/domains/takutaku.com");
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
