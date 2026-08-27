import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DomainDetail } from "@/lib/api/types";
import { NsEditDialog } from "./ns-edit-dialog";

/**
 * D-02 情報修正（NS・コンタクト・移管ロック。FR-09 / #172 / #205）。
 *
 * HTTP モードでは登録者プロファイルが未取得（`registrantProfile` が null）のことがあり、
 * そのとき氏名・メールは空で開く。氏名はレジストリが許可する 8 種のダミー値しか
 * 通らないので、送る前にここで弾く（API に 400 を出させない）。
 */

/** radix は body に pointer-events:none を敷くので、user-event の判定は切る */
const user = () => userEvent.setup({ pointerEventsCheck: 0 });

function buildDomain(overrides: Partial<DomainDetail> = {}): DomainDetail {
  return {
    name: "takutaku.com",
    sld: "takutaku",
    tld: "com",
    registry: "kitaqsign",
    statuses: ["ok"],
    rgpStatuses: [],
    ownership: "owned",
    displayStatus: "active",
    registeredAt: "2026-08-01T00:00:00.000Z",
    expiresAt: "2027-08-01T00:00:00.000Z",
    rgpUntil: null,
    syncedAt: "2026-08-27T00:00:00.000Z",
    stale: false,
    transfer: null,
    nameservers: ["ns1.example.com", "ns2.example.com"],
    registrant: {
      name: "Taro Test",
      email: "taro.test@example.com",
      migrated: true,
    },
    gracePeriods: [],
    transferableFrom: null,
    subdomainPlan: null,
    ...overrides,
  };
}

function renderDialog(overrides: Partial<DomainDetail> = {}) {
  const onSubmit = vi.fn();
  render(
    <NsEditDialog
      busy={false}
      domain={buildDomain(overrides)}
      onOpenChange={() => {}}
      onSubmit={onSubmit}
      open
    />,
  );
  return {
    onSubmit,
    primary: screen.getByRole("button", { name: "情報を修正する" }),
  };
}

describe("NsEditDialog（D-02 情報修正）", () => {
  describe("登録者コンタクト（#172）", () => {
    it("現在の NS と登録者を初期値にして開く", () => {
      renderDialog();

      expect(screen.getByLabelText("ネームサーバー 1")).toHaveValue(
        "ns1.example.com",
      );
      expect(screen.getByLabelText("登録者 氏名")).toHaveValue("Taro Test");
      expect(screen.getByLabelText("登録者 メールアドレス")).toHaveValue(
        "taro.test@example.com",
      );
    });

    it("NS と登録者を変えずに送ると contacts を載せない（NS だけの変更）", async () => {
      const { onSubmit, primary } = renderDialog();

      await user().click(primary);

      expect(onSubmit).toHaveBeenCalledWith({
        nameservers: ["ns1.example.com", "ns2.example.com"],
      });
    });

    it("登録者を変えると contacts を載せて送る", async () => {
      const { onSubmit, primary } = renderDialog();
      const typing = user();

      const email = screen.getByLabelText("登録者 メールアドレス");
      await typing.clear(email);
      await typing.type(email, "hanako.test@example.net");
      await typing.click(primary);

      // 変えていない NS は載せない（送るのは変更した項目だけ）
      expect(onSubmit).toHaveBeenCalledWith({
        contacts: {
          registrant: {
            name: "Taro Test",
            email: "hanako.test@example.net",
          },
        },
      });
    });

    it("許可されていない氏名は送らずにその場でエラーを出す（API に 400 を出させない）", async () => {
      const { onSubmit, primary } = renderDialog();
      const typing = user();

      const name = screen.getByLabelText("登録者 氏名");
      await typing.clear(name);
      await typing.type(name, "山田 太郎");
      await typing.click(primary);

      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByText(/使えるのは/)).toBeInTheDocument();
    });

    it("登録者プロファイルが未取得（空）でも許可された氏名を入れれば送れる", async () => {
      const { onSubmit, primary } = renderDialog({
        registrant: { name: "", email: "", migrated: true },
      });
      const typing = user();

      await typing.type(screen.getByLabelText("登録者 氏名"), "Jane Doe");
      await typing.type(
        screen.getByLabelText("登録者 メールアドレス"),
        "jane.doe@example.com",
      );
      await typing.click(primary);

      expect(onSubmit).toHaveBeenCalledWith({
        contacts: {
          registrant: { name: "Jane Doe", email: "jane.doe@example.com" },
        },
      });
    });
  });

  describe("移管ロック（#205）", () => {
    it("ロックを ON にすると clientTransferProhibited の付与だけを送る", async () => {
      const { onSubmit, primary } = renderDialog();
      const typing = user();

      await typing.click(screen.getByRole("button", { name: "ロックする" }));
      await typing.click(primary);

      expect(onSubmit).toHaveBeenCalledWith({
        clientStatuses: { add: ["clientTransferProhibited"] },
      });
    });

    it("ロックを OFF にすると解除だけを送る（API の unlockOnly 経路に乗せる）", async () => {
      const { onSubmit, primary } = renderDialog({
        statuses: ["ok", "clientTransferProhibited"],
      });
      const typing = user();

      await typing.click(screen.getByRole("button", { name: "解除する" }));
      await typing.click(primary);

      expect(onSubmit).toHaveBeenCalledWith({
        clientStatuses: { remove: ["clientTransferProhibited"] },
      });
    });

    it("NS とロックを同時に変えたら両方を送る", async () => {
      const { onSubmit, primary } = renderDialog();
      const typing = user();

      const ns = screen.getByLabelText("ネームサーバー 2");
      await typing.clear(ns);
      await typing.type(ns, "ns3.example.com");
      await typing.click(screen.getByRole("button", { name: "ロックする" }));
      await typing.click(primary);

      expect(onSubmit).toHaveBeenCalledWith({
        nameservers: ["ns1.example.com", "ns3.example.com"],
        clientStatuses: { add: ["clientTransferProhibited"] },
      });
    });

    it("AC-09-2: serverUpdateProhibited 中はトグルを押せず理由が出る", () => {
      renderDialog({ statuses: ["ok", "serverUpdateProhibited"] });

      expect(screen.getByRole("button", { name: "ロックする" })).toBeDisabled();
      expect(screen.getByText(/serverUpdateProhibited/)).toBeInTheDocument();
    });

    it("serverTransferProhibited が付いていればクライアント側では解除できない", () => {
      renderDialog({ statuses: ["ok", "serverTransferProhibited"] });

      expect(screen.getByRole("button", { name: "解除する" })).toBeDisabled();
    });
  });
});
