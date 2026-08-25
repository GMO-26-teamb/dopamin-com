import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SubdomainHost } from "@/lib/api/types";
import { PlanTree } from "./tree";

const HOSTS: SubdomainHost[] = [
  {
    applyStatus: "applied",
    host: "www",
    id: "sh_001",
    priority: "required",
    purpose: "ランディングページ",
    recordType: "A",
    target: "203.0.113.10",
  },
  {
    applyStatus: "changed",
    host: "docs",
    id: "sh_003",
    priority: "recommended",
    purpose: "ドキュメント",
    recordType: "CNAME",
    target: "docs.example-app.com",
  },
  {
    applyStatus: "pending",
    host: "status",
    id: "sh_004",
    priority: "optional",
    purpose: "ステータスページ",
    recordType: "A",
    target: "203.0.113.20",
  },
];

function renderTree(selectedId: string | null = "sh_001") {
  const onSelect = vi.fn();
  const onAddHost = vi.fn();
  render(
    <PlanTree
      domain="takutaku.com"
      hosts={HOSTS}
      onAddHost={onAddHost}
      onSelect={onSelect}
      selectedId={selectedId}
    />,
  );
  return { onAddHost, onSelect };
}

describe("PlanTree（S-43）", () => {
  it("ルートにドメイン名を出す", () => {
    renderTree();

    expect(screen.getByText("takutaku.com")).toBeInTheDocument();
  });

  it("ホストごとに反映状態バッジを出す（FR-13）", () => {
    renderTree();

    expect(screen.getByText("反映済み")).toBeInTheDocument();
    expect(screen.getByText("変更あり")).toBeInTheDocument();
    expect(screen.getByText("未反映")).toBeInTheDocument();
  });

  it("優先度とレコード種別をバッジで出す", () => {
    renderTree();

    expect(screen.getByText("必須")).toBeInTheDocument();
    expect(screen.getByText("推奨")).toBeInTheDocument();
    expect(screen.getByText("任意")).toBeInTheDocument();
    expect(screen.getAllByText("A")).toHaveLength(2);
    expect(screen.getByText("CNAME")).toBeInTheDocument();
  });

  it("選択中のノードだけ aria-pressed が立つ", () => {
    renderTree("sh_003");

    const nodes = screen
      .getAllByRole("button")
      .filter((node) => node.getAttribute("aria-pressed") !== null);
    const pressed = nodes.filter(
      (node) => node.getAttribute("aria-pressed") === "true",
    );

    expect(nodes).toHaveLength(3);
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toHaveTextContent("docs");
  });

  it("ノードを押すと選択が伝わる", async () => {
    const { onSelect } = renderTree();

    const node = screen
      .getAllByRole("button")
      .find((element) => element.textContent?.startsWith("status"));
    expect(node).toBeDefined();
    if (node) {
      await userEvent.setup().click(node);
    }

    expect(onSelect).toHaveBeenCalledWith("sh_004");
  });

  it("「ホストを追加」で追加を呼ぶ", async () => {
    const { onAddHost } = renderTree();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "ホストを追加" }));

    expect(onAddHost).toHaveBeenCalledTimes(1);
  });
});
