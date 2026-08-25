import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api/errors";
import {
  createMockServices,
  resetMockStore,
} from "@/lib/api/mock/mock-services";
import { AppProviders } from "@/lib/api/query-client";
import type { Services } from "@/lib/api/services";
import type { DomainDetail, SearchResult } from "@/lib/api/types";
import {
  RegisterConflictDialog,
  RegisterSuccessDialog,
  RegisterTimeoutDialog,
} from "./register-result-dialogs";

/**
 * S-26（成功）/ S-27（409）/ S-28（create タイムアウトの照合 4 分岐）。
 * S-28 は `?mock=error` だと `check` も落ちて登録ダイアログまで辿り着けないため、
 * 分岐はここでサービスを差し替えて確かめる。
 */

const DOMAIN: DomainDetail = {
  name: "takutaku.com",
  sld: "takutaku",
  tld: "com",
  registry: "kitaqsign",
  statuses: ["inactive"],
  rgpStatuses: [],
  ownership: "owned",
  displayStatus: "inactive",
  registeredAt: "2026-08-26T01:00:00.000Z",
  expiresAt: "2027-08-26T01:00:00.000Z",
  rgpUntil: null,
  syncedAt: "2026-08-26T01:00:00.000Z",
  stale: false,
  transfer: null,
  nameservers: [],
  registrant: {
    name: "Taro Test",
    email: "taro.test@example.com",
    migrated: true,
  },
  gracePeriods: [],
  transferableFrom: null,
  subdomainPlan: null,
};

const TIMEOUT_ERROR = new ApiClientError({
  code: "REGISTRY_TIMEOUT",
  message: "レジストリが応答しませんでした。",
  registry: "kitaqsign",
  requestId: "req_01J8ZQ7M2K",
});

function searchResult(
  availability: SearchResult["availability"],
): SearchResult {
  return {
    name: DOMAIN.name,
    sld: DOMAIN.sld,
    tld: DOMAIN.tld,
    registry: "kitaqsign",
    availability,
    uniqueness: null,
    alternatives: ["takutaku.xyz"],
    error: null,
  };
}

function servicesWith(overrides: {
  get: Services["domains"]["get"];
  check: Services["domains"]["check"];
}): Services {
  const services = createMockServices("default", { delayMs: 0 });
  return {
    ...services,
    domains: { ...services.domains, ...overrides },
  };
}

afterEach(() => resetMockStore());

describe("RegisterSuccessDialog（S-26）", () => {
  it("状態・有効期限と次の一手を出す", async () => {
    const onGoToSubdomains = vi.fn();
    const onGoToDetail = vi.fn();
    render(
      <RegisterSuccessDialog
        domain={DOMAIN}
        onGoToDetail={onGoToDetail}
        onGoToSubdomains={onGoToSubdomains}
        onOpenChange={() => {}}
      />,
    );

    expect(screen.getByText("取得できました")).toBeInTheDocument();
    expect(screen.getByText("takutaku.com")).toBeInTheDocument();
    expect(screen.getByText(/有効期限 2027-08-26/)).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "サブドメイン設計に進む" }),
    );
    expect(onGoToSubdomains).toHaveBeenCalledWith("takutaku.com");
    await userEvent.click(screen.getByRole("button", { name: "詳細を見る" }));
    expect(onGoToDetail).toHaveBeenCalledWith("takutaku.com");
  });
});

describe("RegisterConflictDialog（S-27）", () => {
  it("代替候補 3 件までを本文に並べ、S-24 へ渡す", async () => {
    const onShowAlternatives = vi.fn();
    render(
      <RegisterConflictDialog
        conflict={{
          name: "takutaku.com",
          alternatives: ["a.com", "b.com", "c.com", "d.com"],
        }}
        onOpenChange={() => {}}
        onShowAlternatives={onShowAlternatives}
      />,
    );

    expect(
      screen.getByText("takutaku.com は取得できませんでした"),
    ).toBeInTheDocument();
    expect(screen.getByText("a.com・b.com・c.com")).toBeInTheDocument();
    expect(screen.getByText(/CONFLICT \/ 409/)).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "代替候補を見る" }),
    );
    expect(onShowAlternatives).toHaveBeenCalledWith([
      "a.com",
      "b.com",
      "c.com",
    ]);
  });
});

describe("RegisterTimeoutDialog（S-28）", () => {
  function setup(overrides: {
    get: Services["domains"]["get"];
    check: Services["domains"]["check"];
  }) {
    const onOutcome = vi.fn();
    render(
      <AppProviders services={servicesWith(overrides)}>
        <RegisterTimeoutDialog
          onOpenChange={() => {}}
          onOutcome={onOutcome}
          timeout={{ name: DOMAIN.name, error: TIMEOUT_ERROR }}
        />
      </AppProviders>,
    );
    return { onOutcome, user: userEvent.setup() };
  }

  const notFound = () =>
    Promise.reject(
      new ApiClientError({ code: "NOT_FOUND", message: "ありません。" }),
    );

  it("FR-18 の一文とエラーコードを出し、再送はしない", () => {
    setup({ get: notFound, check: async () => [searchResult("available")] });

    expect(
      screen.getByText("Kitaqsign が応答しませんでした"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ローカルの情報は変更されていません/),
    ).toBeInTheDocument();
    expect(screen.getByText(/再送はせず/)).toBeInTheDocument();
    expect(
      screen.getByText("REGISTRY_TIMEOUT・504・req_01J8ZQ7M2K"),
    ).toBeInTheDocument();
  });

  it("登録済み → registered を返す（S-30 へ）", async () => {
    const { onOutcome, user } = setup({
      get: async () => DOMAIN,
      check: async () => [searchResult("available")],
    });

    await user.click(screen.getByRole("button", { name: "結果を確認" }));

    await waitFor(() =>
      expect(onOutcome).toHaveBeenCalledWith({
        kind: "registered",
        domain: DOMAIN,
      }),
    );
  });

  it("空きのまま → available を返す（S-25 に戻る）", async () => {
    const { onOutcome, user } = setup({
      get: notFound,
      check: async () => [searchResult("available")],
    });

    await user.click(screen.getByRole("button", { name: "結果を確認" }));

    await waitFor(() =>
      expect(onOutcome).toHaveBeenCalledWith({ kind: "available" }),
    );
  });

  it("他者取得 → taken を返す（S-27 へ）", async () => {
    const { onOutcome, user } = setup({
      get: notFound,
      check: async () => [searchResult("unavailable")],
    });

    await user.click(screen.getByRole("button", { name: "結果を確認" }));

    await waitFor(() =>
      expect(onOutcome).toHaveBeenCalledWith({
        kind: "taken",
        alternatives: ["takutaku.xyz"],
      }),
    );
  });

  it("照合失敗 → S-28 のまま Error Card と「もう一度確認」を出す", async () => {
    const { onOutcome, user } = setup({
      get: notFound,
      check: async () => [searchResult("error")],
    });

    await user.click(screen.getByRole("button", { name: "結果を確認" }));

    expect(
      await screen.findByRole("button", { name: "もう一度確認" }),
    ).toBeInTheDocument();
    expect(screen.getByText("レジストリに接続できません")).toBeInTheDocument();
    expect(onOutcome).not.toHaveBeenCalled();
  });
});
