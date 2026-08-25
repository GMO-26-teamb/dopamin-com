import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sheet } from "./sheet";

function Fixture({ modal }: { modal?: boolean }) {
  return (
    <>
      <button type="button">外側のボタン</button>
      <Sheet modal={modal} onOpenChange={() => {}} open title="AI ログ">
        <p>中身</p>
      </Sheet>
    </>
  );
}

const overlay = () => document.querySelector('[data-slot="sheet-overlay"]');

describe("Sheet", () => {
  it("既定（モーダル）はオーバーレイを出し、背後をアクセシビリティツリーから隠す", () => {
    render(<Fixture />);

    expect(screen.getByRole("dialog", { name: "AI ログ" })).toBeInTheDocument();
    expect(overlay()).not.toBeNull();
    // hideOthers による aria-hidden で、外側はロール検索に出てこない
    expect(
      screen.queryByRole("button", { name: "外側のボタン" }),
    ).not.toBeInTheDocument();
  });

  it("modal={false} はオーバーレイを出さず、背後を操作できる状態のまま残す", () => {
    render(<Fixture modal={false} />);

    expect(screen.getByRole("dialog", { name: "AI ログ" })).toBeInTheDocument();
    expect(overlay()).toBeNull();

    const outside = screen.getByRole("button", { name: "外側のボタン" });
    expect(outside).toBeInTheDocument();
    expect(outside.closest("[aria-hidden]")).toBeNull();
  });
});
