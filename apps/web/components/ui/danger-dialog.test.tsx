import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DangerDialog } from "./dialog";

/** radix は body に pointer-events:none を敷くので、user-event の判定は切る */
const user = () => userEvent.setup({ pointerEventsCheck: 0 });

function renderDialog(onPrimary = vi.fn()) {
  render(
    <DangerDialog
      confirmLabel="確認のためドメイン名を入力"
      confirmText="takutaku.com"
      onOpenChange={() => {}}
      onPrimary={onPrimary}
      open
      primaryLabel="廃止する"
      subtitle="登録から 5 日を過ぎているため、30 日間の復旧猶予（RGP）の後に完全に削除されます。"
      title="takutaku.com を廃止しますか？"
    />,
  );
  return {
    onPrimary,
    primary: screen.getByRole("button", { name: "廃止する" }),
    input: screen.getByLabelText("確認のためドメイン名を入力"),
  };
}

describe("DangerDialog", () => {
  it("確認テキストが未入力のあいだは主要ボタンを押せない", async () => {
    const { primary, onPrimary } = renderDialog();

    expect(primary).toBeDisabled();

    await user().click(primary);
    expect(onPrimary).not.toHaveBeenCalled();
  });

  it("途中まで入力しても一致しなければ押せない", async () => {
    const { primary, input } = renderDialog();

    await user().type(input, "takutaku.co");

    expect(primary).toBeDisabled();
  });

  it("確認テキストと一致すると押せるようになり、押すと onPrimary が呼ばれる", async () => {
    const { primary, input, onPrimary } = renderDialog();
    const typing = user();

    await typing.type(input, "takutaku.com");
    expect(primary).toBeEnabled();

    await typing.click(primary);
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it("タイトルと補足を表示する", () => {
    renderDialog();

    expect(
      screen.getByRole("heading", { name: "takutaku.com を廃止しますか？" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/30 日間の復旧猶予/)).toBeInTheDocument();
  });
});
