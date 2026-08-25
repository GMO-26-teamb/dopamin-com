import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CodeBlock } from "./code-block";

const CODE = "www 3600 IN CNAME cname.vercel-dns.com.";

/**
 * user-event の setup() は自前の clipboard スタブを view に挿すので、
 * 必ず setup() より後に差し替える。
 */
function stubClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

describe("CodeBlock", () => {
  it("コードをそのまま描画する", () => {
    render(<CodeBlock code={CODE} />);

    expect(screen.getByText(CODE)).toBeInTheDocument();
  });

  // 2 秒後に戻るところまで見るので、実タイマーで待つ
  it("コピーするとクリップボードに書き込み、2 秒だけ「コピーしました」を出す", async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    render(<CodeBlock code={CODE} />);

    await user.click(screen.getByRole("button", { name: "コピー" }));

    expect(writeText).toHaveBeenCalledWith(CODE);
    expect(
      await screen.findByRole("button", { name: "コピーしました" }),
    ).toBeInTheDocument();

    expect(
      await screen.findByRole("button", { name: "コピー" }, { timeout: 3000 }),
    ).toBeInTheDocument();
  }, 6000);

  it("クリップボードが失敗しても落ちない", async () => {
    const user = userEvent.setup();
    stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    render(<CodeBlock code={CODE} />);

    await user.click(screen.getByRole("button", { name: "コピー" }));

    expect(screen.getByRole("button", { name: "コピー" })).toBeInTheDocument();
  });
});
