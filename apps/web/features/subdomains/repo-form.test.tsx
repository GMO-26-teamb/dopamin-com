import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DescriptionForm, RepoForm } from "./repo-form";

describe("RepoForm（S-40 / S-41）", () => {
  it("URL が空のうちは解析できない", () => {
    render(
      <RepoForm
        analyzing={false}
        descriptionOpen={false}
        onDescriptionOpenChange={vi.fn()}
        onPropose={vi.fn()}
        onRepoUrlChange={vi.fn()}
        repoUrl=""
      />,
    );

    expect(
      screen.getByRole("button", { name: "リポジトリを解析" }),
    ).toBeDisabled();
  });

  it("URL を渡すと解析でき、前後の空白は落とす", async () => {
    const onPropose = vi.fn();
    render(
      <RepoForm
        analyzing={false}
        descriptionOpen={false}
        onDescriptionOpenChange={vi.fn()}
        onPropose={onPropose}
        onRepoUrlChange={vi.fn()}
        repoUrl="  https://github.com/example/app  "
      />,
    );

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "リポジトリを解析" }));

    expect(onPropose).toHaveBeenCalledWith({
      repoUrl: "https://github.com/example/app",
    });
  });

  it("解析中はラベルが「解析中…」になり二重送信できない（ui-screens §4）", () => {
    render(
      <RepoForm
        analyzing
        descriptionOpen={false}
        onDescriptionOpenChange={vi.fn()}
        onPropose={vi.fn()}
        onRepoUrlChange={vi.fn()}
        repoUrl="https://github.com/example/app"
      />,
    );

    expect(screen.getByRole("button", { name: "解析中…" })).toBeDisabled();
  });

  it("「概要を書いて提案」で概要欄の開閉を伝える", async () => {
    const onDescriptionOpenChange = vi.fn();
    render(
      <RepoForm
        analyzing={false}
        descriptionOpen={false}
        onDescriptionOpenChange={onDescriptionOpenChange}
        onPropose={vi.fn()}
        onRepoUrlChange={vi.fn()}
        repoUrl=""
      />,
    );

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "概要を書いて提案" }));

    expect(onDescriptionOpenChange).toHaveBeenCalledWith(true);
  });
});

describe("DescriptionForm（S-42）", () => {
  it("概要を入れると提案できる（AC-13-2）", async () => {
    const onPropose = vi.fn();
    render(<DescriptionForm analyzing={false} onPropose={onPropose} />);

    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "概要から提案" });
    expect(button).toBeDisabled();

    await user.type(
      screen.getByLabelText("プロジェクト概要"),
      "Next.js のポートフォリオ",
    );
    await user.click(button);

    expect(onPropose).toHaveBeenCalledWith({
      description: "Next.js のポートフォリオ",
    });
  });
});
