import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Banner } from "./banner";

describe("Banner", () => {
  it("tone=warn は role=alert で読み上げる", () => {
    render(<Banner title="DNS の反映に失敗しました" tone="warn" />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "DNS の反映に失敗しました",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("tone=ok / info は role=status で読み上げる", () => {
    const { rerender } = render(
      <Banner title="DNS に反映しました" tone="ok" />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    rerender(<Banner title="移管を受け付けました" tone="info" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("body を渡すとタイトルの下に表示する", () => {
    render(
      <Banner
        body="4 ホストを反映 · ネームサーバーはドパ民 DNS"
        title="DNS に反映しました"
        tone="ok"
      />,
    );

    expect(
      screen.getByText("4 ホストを反映 · ネームサーバーはドパ民 DNS"),
    ).toBeInTheDocument();
  });

  it("onClose を渡すと閉じるボタンが出て、押すと呼ばれる", async () => {
    const onClose = vi.fn();
    render(<Banner onClose={onClose} title="DNS に反映しました" tone="ok" />);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "閉じる" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("閉じるボタンで実際に閉じられる", async () => {
    function Host() {
      const [open, setOpen] = useState(true);
      return open ? (
        <Banner
          onClose={() => setOpen(false)}
          title="DNS に反映しました"
          tone="ok"
        />
      ) : null;
    }
    render(<Host />);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "閉じる" }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("onClose を渡さないと閉じるボタンを出さない", () => {
    render(<Banner title="DNS に反映しました" tone="ok" />);

    expect(screen.queryByRole("button", { name: "閉じる" })).toBeNull();
  });

  it("action を渡すと本文の右に描画する", () => {
    render(
      <Banner
        action={<button type="button">操作ログを見る</button>}
        title="Kitaqsign が応答しませんでした"
        tone="warn"
      />,
    );

    expect(
      screen.getByRole("button", { name: "操作ログを見る" }),
    ).toBeInTheDocument();
  });
});
