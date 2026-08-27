import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createMockServices,
  resetMockStore,
} from "@/lib/api/mock/mock-services";
import type { MockScenario } from "@/lib/api/mock/scenario";
import { AppProviders } from "@/lib/api/query-client";
import { SubdomainsScreen } from "./subdomains-screen";

/**
 * S-40 〜 S-46 をモックのシナリオごとに通しで確認する（fe-ui 設計 §6 の URL 表に対応）。
 * - `/domains/takutaku.com/subdomains` = 設計あり（S-43）
 * - `/domains/harupika.xyz/subdomains` = 設計なし（S-40）
 * - `?mock=error` → S-42 / `?mock=ai-timeout` → S-41 の AI 失敗 / `?mock=ns-fail` → S-46
 */

function renderScreen(domain: string, scenario: MockScenario = "default") {
  render(
    <AppProviders services={createMockServices(scenario, { delayMs: 0 })}>
      <SubdomainsScreen domain={domain} />
    </AppProviders>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  resetMockStore();
});

describe("SubdomainsScreen", () => {
  it("S-43: 保存済み設計をツリー + 反映状況 + 反映 CTA で出す", async () => {
    renderScreen("takutaku.com");

    expect(
      await screen.findByText("反映済み 2・変更あり 1・未反映 1"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("反映済み")).toHaveLength(2);
    expect(screen.getByText("変更あり")).toBeInTheDocument();
    expect(screen.getByText("未反映")).toBeInTheDocument();
    expect(
      screen.getByText("反映済み 2・変更あり 1・未反映 1"),
    ).toBeInTheDocument();
    expect(screen.getByText("未切替")).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "DNS に反映（差分 2 件）" }),
      ).toBeEnabled();
    });
  });

  it("S-43: 反映の Primary は 1 つだけ（Page Header には置かない）", async () => {
    renderScreen("takutaku.com");

    await screen.findByText("反映済み 2・変更あり 1・未反映 1");
    // 「DNS に反映」を名乗るボタンは反映セクションの 1 つだけ
    expect(screen.getAllByRole("button", { name: /DNS に反映/ })).toHaveLength(
      1,
    );
  });

  it("S-43: 手動設定のコードは既定で畳んでおく", async () => {
    const user = renderScreen("takutaku.com");

    await screen.findByText("反映済み 2・変更あり 1・未反映 1");
    const toggle = screen.getByRole("button", { name: "手動で設定する場合" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/3600 IN/)).toBeNull();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/3600 IN/)).toBeInTheDocument();
  });

  it("S-40: 設計が無ければ案内の Empty State を出す", async () => {
    renderScreen("harupika.xyz");

    expect(
      await screen.findByText("リポジトリを解析して構成を提案します"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "設計を保存" })).toBeDisabled();
    // 設計が無い間は反映するものが無いので、反映の導線自体を出さない
    expect(screen.queryByRole("button", { name: /DNS に反映/ })).toBeNull();
  });

  it("S-40 → S-43: リポジトリを解析すると提案が出る", async () => {
    const user = renderScreen("harupika.xyz");

    await screen.findByText("リポジトリを解析して構成を提案します");
    await user.type(
      screen.getByLabelText("リポジトリ URL"),
      "https://github.com/example/harupika",
    );
    await user.click(screen.getByRole("button", { name: "リポジトリを解析" }));

    expect(await screen.findByText("反映済み 0・未反映 4")).toBeInTheDocument();
    expect(screen.getAllByText("未反映")).toHaveLength(4);
    expect(screen.getByLabelText("全体方針")).toHaveValue(
      "www と api を必須、docs と status は任意。TTL は 300 秒で統一する。",
    );
  });

  it("提案しただけでは未保存なので、保存してからでないと反映できない（FR-13）", async () => {
    const user = renderScreen("harupika.xyz");

    await screen.findByText("リポジトリを解析して構成を提案します");
    await user.type(
      screen.getByLabelText("リポジトリ URL"),
      "https://github.com/example/harupika",
    );
    await user.click(screen.getByRole("button", { name: "リポジトリを解析" }));

    await screen.findByText("反映済み 0・未反映 4");
    expect(screen.getByRole("button", { name: "設計を保存" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^DNS に反映/ })).toBeDisabled();
    expect(
      screen.getByText("未保存の変更があります。先に設計を保存してください。"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "設計を保存" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^DNS に反映/ })).toBeEnabled();
    });
    // 保存後は差分が無くなるまで再保存の必要が無い
    expect(screen.getByRole("button", { name: "設計を保存" })).toBeDisabled();
  });

  it("S-43: 再解析に失敗したら Banner Warn と概要入力を出す（AC-13-2）", async () => {
    const user = renderScreen("takutaku.com", "error");

    await screen.findByText("反映済み 2・変更あり 1・未反映 1");
    await user.click(screen.getByRole("button", { name: "リポジトリを解析" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "リポジトリを取得できません",
      );
    });
    expect(screen.getByLabelText("プロジェクト概要")).toBeInTheDocument();
    // 保存済みの設計は消さない
    expect(screen.getByLabelText("全体方針")).toBeInTheDocument();
  });

  it("S-42: リポジトリを取得できないと概要入力に切り替わる（AC-13-2）", async () => {
    const user = renderScreen("harupika.xyz", "error");

    await screen.findByText("リポジトリを解析して構成を提案します");
    await user.type(
      screen.getByLabelText("リポジトリ URL"),
      "https://github.com/example/private",
    );
    await user.click(screen.getByRole("button", { name: "リポジトリを解析" }));

    expect(
      await screen.findByText("リポジトリを取得できません"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("プロジェクト概要")).toBeInTheDocument();
  });

  it("S-41: AI が応答しないと S-40 に戻して Banner Warn を出す", async () => {
    const user = renderScreen("harupika.xyz", "ai-timeout");

    await screen.findByText("リポジトリを解析して構成を提案します");
    await user.type(
      screen.getByLabelText("リポジトリ URL"),
      "https://github.com/example/harupika",
    );
    await user.click(screen.getByRole("button", { name: "リポジトリを解析" }));

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("AI が応答しませんでした");
    expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
    // 概要入力には切り替えない（リポは取得できている）
    expect(screen.queryByText("リポジトリを取得できません")).toBeNull();
  });

  it("S-44 → S-45: 差分を確認して反映すると全ノードが反映済みになる（AC-13-4 / 7）", async () => {
    const user = renderScreen("takutaku.com");

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "DNS に反映（差分 2 件）" }),
      ).toBeEnabled();
    });
    await user.click(
      screen.getByRole("button", { name: "DNS に反映（差分 2 件）" }),
    );

    // S-44: 件数チップと対象ホスト
    expect(await screen.findByText("DNS に反映しますか？")).toBeInTheDocument();
    expect(screen.getByText("追加 1")).toBeInTheDocument();
    expect(screen.getByText("変更 1")).toBeInTheDocument();
    expect(screen.getByText("削除 0")).toBeInTheDocument();
    expect(screen.getByText("変更なし 2（www・api）")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "反映する" }));

    // S-45: Banner Ok + 全ノード「反映済み」+ CTA Disabled
    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent("DNS に反映しました");
    expect(banner).toHaveTextContent(
      "4 ホストを反映（追加 1・変更 1）・ネームサーバーはドパ民 DNS",
    );
    await waitFor(() => {
      expect(screen.getByText("反映済み 4・差分なし")).toBeInTheDocument();
    });
    expect(screen.getByText("切替済み")).toBeInTheDocument();
    // ボタンは動作名のまま Disabled。差分が無いことは「反映状況」行が言う
    expect(screen.getByRole("button", { name: "DNS に反映" })).toBeDisabled();
  });

  it("S-46: NS 切替に失敗したら Banner Warn を出しレコードは変えない（AC-13-5）", async () => {
    const user = renderScreen("takutaku.com", "ns-fail");

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "DNS に反映（差分 2 件）" }),
      ).toBeEnabled();
    });
    await user.click(
      screen.getByRole("button", { name: "DNS に反映（差分 2 件）" }),
    );
    await user.click(await screen.findByRole("button", { name: "反映する" }));

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("ネームサーバーの切替に失敗しました");
    // レコードは未変更のまま
    expect(
      screen.getByText("反映済み 2・変更あり 1・未反映 1"),
    ).toBeInTheDocument();
    expect(screen.getByText("未切替")).toBeInTheDocument();
  });

  it("編集して保存すると該当ホストが「変更あり」になる（AC-13-6）", async () => {
    const user = renderScreen("takutaku.com");

    await screen.findByText("反映済み 2・変更あり 1・未反映 1");
    const target = screen.getByLabelText("向き先");
    await user.clear(target);
    await user.type(target, "203.0.113.99");

    // 未保存のうちは反映できない（反映対象は保存済み設計）
    expect(
      screen.getByText("未保存の変更があります。先に設計を保存してください。"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "設計を保存" }));

    await waitFor(() => {
      expect(
        screen.getByText("反映済み 1・変更あり 2・未反映 1"),
      ).toBeInTheDocument();
    });
  });

  // 保存前の入力検証（AC-13-3）。契約（savedSubdomainProposalSchema）を満たさない設計を
  // サーバーに投げると 400 が返るだけなので、押した時点で欄に戻す
  it("追加した直後のホストのまま保存すると、欄でエラーを出して保存しない", async () => {
    const user = renderScreen("takutaku.com");

    await screen.findByText("反映済み 2・変更あり 1・未反映 1");
    await user.click(screen.getByRole("button", { name: "ホストを追加" }));
    await user.click(screen.getByRole("button", { name: "設計を保存" }));

    expect(screen.getByText("new: 用途を入力してください")).toBeInTheDocument();
    expect(screen.getByText("用途を入力してください")).toBeInTheDocument();
    expect(screen.getByText("向き先を入力してください")).toBeInTheDocument();
    // 保存されていないので未保存のままで、反映もできない
    expect(
      screen.getByText("未保存の変更があります。先に設計を保存してください。"),
    ).toBeInTheDocument();
  });

  it("欄を埋めれば保存できる（エラーは消える）", async () => {
    const user = renderScreen("takutaku.com");

    await screen.findByText("反映済み 2・変更あり 1・未反映 1");
    await user.click(screen.getByRole("button", { name: "ホストを追加" }));
    await user.click(screen.getByRole("button", { name: "設計を保存" }));
    await user.type(screen.getByLabelText("用途"), "管理画面");
    await user.type(screen.getByLabelText("向き先"), "admin.example-app.com");
    await user.click(screen.getByRole("button", { name: "設計を保存" }));

    await waitFor(() => {
      expect(
        screen.getByText("反映済み 2・変更あり 1・未反映 2"),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByText("用途を入力してください"),
    ).not.toBeInTheDocument();
  });

  it("A レコードにホスト名を入れたまま保存すると欄で指摘する", async () => {
    const user = renderScreen("takutaku.com");

    await screen.findByText("反映済み 2・変更あり 1・未反映 1");
    const target = screen.getByLabelText("向き先");
    await user.clear(target);
    await user.type(target, "cname.example.com");
    await user.click(screen.getByRole("button", { name: "設計を保存" }));

    expect(
      screen.getByText(
        "A レコードの向き先は IPv4 アドレスで指定してください（例 203.0.113.10）",
      ),
    ).toBeInTheDocument();
  });

  it("ホストを全部消して保存すると 1 件以上必要だと出す", async () => {
    const user = renderScreen("takutaku.com");

    await screen.findByText("反映済み 2・変更あり 1・未反映 1");
    for (let i = 0; i < 4; i += 1) {
      await user.click(
        screen.getByRole("button", { name: "このホストを削除" }),
      );
    }

    expect(
      screen.getByText("ホストを追加すると編集できます。"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "設計を保存" }));

    expect(
      screen.getByText("ホストは 1 件以上必要です。ホストを追加してください"),
    ).toBeInTheDocument();
  });

  it("上限（8 件）に達したら「ホストを追加」を押せなくする", async () => {
    const user = renderScreen("takutaku.com");

    await screen.findByText("反映済み 2・変更あり 1・未反映 1");
    for (let i = 0; i < 4; i += 1) {
      await user.click(screen.getByRole("button", { name: "ホストを追加" }));
    }

    expect(screen.getByRole("button", { name: "ホストを追加" })).toBeDisabled();
  });
});
