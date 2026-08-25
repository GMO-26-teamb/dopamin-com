import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockServices } from "@/lib/api/mock/mock-services";
import type { MockScenario } from "@/lib/api/mock/scenario";
import { resetMockStore } from "@/lib/api/mock/store";
import { AppProviders } from "@/lib/api/query-client";
import type { DomainSummary } from "@/lib/api/types";
import DashboardPage, { shouldAutoSync } from "./page";

/**
 * S-10 / S-11 / S-12 / S-13 の分岐をモックサービス越しに確かめる。
 * `?mock=` を付けた dev サーバーでの目視確認と同じ経路を jsdom で通す。
 */
function renderDashboard(scenario: MockScenario) {
  render(
    <AppProviders services={createMockServices(scenario, { delayMs: 0 })}>
      <DashboardPage />
    </AppProviders>,
  );
}

const NOW = new Date("2026-08-26T10:00:00+09:00");

/** shouldAutoSync は syncedAt しか見ないので、他のフィールドはダミーで固定する。 */
function domainSyncedAgo(seconds: number): DomainSummary {
  return {
    name: "takutaku.com",
    sld: "takutaku",
    tld: "com",
    registry: "kitaqsign",
    statuses: ["ok"],
    rgpStatuses: [],
    ownership: "owned",
    displayStatus: "active",
    registeredAt: new Date(NOW.getTime() - 400 * 86_400_000).toISOString(),
    expiresAt: new Date(NOW.getTime() + 330 * 86_400_000).toISOString(),
    rgpUntil: null,
    syncedAt: new Date(NOW.getTime() - seconds * 1000).toISOString(),
    stale: false,
    transfer: null,
  };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    resetMockStore();
    // fixtures（MOCK_NOW）は実時刻より先の可能性があるため、実時刻に依存しないよう固定する
    // （固定しないと自動同期の鮮度ガードが「まだ新しい」と誤判定し S-13 の Banner が出なくなる）。
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-26T11:00:00+09:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("S-12: 取得中は Domain Card 型の Skeleton を出す", () => {
    renderDashboard("default");

    expect(screen.getByText("保有ドメインを読み込み中…")).toBeInTheDocument();
    expect(screen.getByText("読み込み中…")).toBeInTheDocument();
  });

  it("S-10: 保有ドメイン 4 件を 2 列で出し、件数と最終同期を見出しに出す", async () => {
    renderDashboard("default");

    expect(await screen.findByText("takutaku.com")).toBeInTheDocument();
    expect(screen.getByText("harupika.xyz")).toBeInTheDocument();
    expect(screen.getByText("demo-app.online")).toBeInTheDocument();
    expect(screen.getByText("tkt-lab.net")).toBeInTheDocument();
    // 移管済み（old-blog.xyz）は出さない（AC-02-4）
    expect(screen.queryByText("old-blog.xyz")).not.toBeInTheDocument();
    expect(screen.getByText(/^4件 · 最終同期 /)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "最新化" })).toBeInTheDocument();
  });

  it("S-11: 0 件は Empty State と 2 つの CTA", async () => {
    renderDashboard("empty");

    expect(
      await screen.findByText("まだドメインがありません"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "ドメインを取得" }),
    ).toHaveAttribute("href", "/domains/new");
    expect(
      screen.getByRole("link", { name: "移管で持ち込む" }),
    ).toHaveAttribute("href", "/transfers");
    expect(screen.getByText("0件")).toBeInTheDocument();
  });

  it("S-13: 同期に失敗したら Banner Warn + キャッシュ表示（AC-18-1）", async () => {
    renderDashboard("stale");

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent(
      "Kitaqsign が応答しません — 一覧はキャッシュを表示しています",
    );
    expect(screen.getByText(/（キャッシュ）$/)).toBeInTheDocument();
    expect(screen.getAllByText("Stale")).toHaveLength(4);
    // 更新系は Disabled、参照系（詳細）は押せる
    expect(screen.getByRole("button", { name: "更新" })).toBeDisabled();
    expect(screen.getAllByRole("link", { name: "詳細" }).length).toBe(3);
  });

  it("参照系が落ちたら Error Card + 再試行（ui-screens §4）", async () => {
    renderDashboard("error");

    expect(
      await screen.findByText("Kitaqsign に接続できません", undefined, {
        timeout: 10_000,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
  });
});

describe("shouldAutoSync", () => {
  it("最終同期が 60 秒未満（新鮮）ならスキップする", () => {
    expect(shouldAutoSync([domainSyncedAgo(1)], NOW)).toBe(false);
    expect(shouldAutoSync([domainSyncedAgo(59)], NOW)).toBe(false);
  });

  it("最終同期が 60 秒以上（陳腐化）なら同期する", () => {
    expect(shouldAutoSync([domainSyncedAgo(60)], NOW)).toBe(true);
    expect(shouldAutoSync([domainSyncedAgo(600)], NOW)).toBe(true);
  });

  it("一覧が空（初回ロード前）なら同期する", () => {
    expect(shouldAutoSync([], NOW)).toBe(true);
  });

  it("複数件あるときはもっとも新しい syncedAt を基準にする", () => {
    const domains = [domainSyncedAgo(600), domainSyncedAgo(1)];
    expect(shouldAutoSync(domains, NOW)).toBe(false);
  });
});
