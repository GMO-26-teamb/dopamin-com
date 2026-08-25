import { describe, expect, it } from "vitest";
import { isOperationAllowed, isRestorable } from "./operations";

describe("isOperationAllowed（§9.2 / §11.3）", () => {
  it("ok のみなら全操作可", () => {
    for (const op of ["renew", "update", "delete", "transferOut"] as const) {
      expect(isOperationAllowed(op, ["ok"]).allowed).toBe(true);
    }
  });

  it("pendingDelete / pendingTransfer は全操作をブロックする", () => {
    for (const pending of ["pendingDelete", "pendingTransfer"]) {
      const check = isOperationAllowed("renew", [pending]);
      expect(check.allowed).toBe(false);
      expect(check.blockedBy).toContain(pending);
    }
  });

  it("client/server の各 Prohibited が対応する操作をブロックする", () => {
    expect(
      isOperationAllowed("delete", ["clientDeleteProhibited"]).allowed,
    ).toBe(false);
    expect(
      isOperationAllowed("delete", ["serverDeleteProhibited"]).allowed,
    ).toBe(false);
    expect(
      isOperationAllowed("update", ["serverUpdateProhibited"]).allowed,
    ).toBe(false);
    expect(isOperationAllowed("renew", ["clientRenewProhibited"]).allowed).toBe(
      false,
    );
    expect(
      isOperationAllowed("transferOut", ["clientTransferProhibited"]).allowed,
    ).toBe(false);
    // 無関係な操作はブロックしない
    expect(
      isOperationAllowed("renew", ["clientDeleteProhibited"]).allowed,
    ).toBe(true);
  });

  it("update: unlockOnly なら clientUpdateProhibited でも許可（Server 側は不可）", () => {
    expect(
      isOperationAllowed("update", ["clientUpdateProhibited"], {
        unlockOnly: true,
      }).allowed,
    ).toBe(true);
    expect(
      isOperationAllowed("update", ["clientUpdateProhibited"], {
        unlockOnly: false,
      }).allowed,
    ).toBe(false);
    expect(
      isOperationAllowed("update", ["serverUpdateProhibited"], {
        unlockOnly: true,
      }).allowed,
    ).toBe(false);
  });

  it("移管系の操作も対応する Prohibited でブロックされる（§11.3 移管ロック）", () => {
    for (const op of ["transferIn", "transferOut", "authCode"] as const) {
      expect(isOperationAllowed(op, ["ok"]).allowed).toBe(true);
      expect(isOperationAllowed(op, ["serverTransferProhibited"]).allowed).toBe(
        false,
      );
      expect(isOperationAllowed(op, ["clientTransferProhibited"]).allowed).toBe(
        false,
      );
    }
  });
});

describe("ownership = transferred_out（AC-12-5）", () => {
  const ALL_OPERATIONS = [
    "renew",
    "update",
    "delete",
    "transferOut",
    "transferIn",
    "transferApprove",
    "transferReject",
    "transferCancel",
    "authCode",
    "restore",
  ] as const;

  it("移管 OUT 完了後は EPP ステータスに関わらず全操作不可", () => {
    for (const op of ALL_OPERATIONS) {
      const check = isOperationAllowed(op, ["ok"], {
        ownership: "transferred_out",
      });
      expect(check.allowed).toBe(false);
      expect(check.blockedBy).toEqual(["transferred_out"]);
    }
  });

  it("RGP 中でも移管済みなら復旧できない", () => {
    expect(
      isOperationAllowed("restore", ["pendingDelete"], {
        ownership: "transferred_out",
        rgpStatuses: ["redemptionPeriod"],
      }).allowed,
    ).toBe(false);
  });

  it("ownership = owned は従来どおり", () => {
    expect(
      isOperationAllowed("renew", ["ok"], { ownership: "owned" }).allowed,
    ).toBe(true);
  });
});

describe("pendingTransfer 中の方向別の可否（AC-07-3）", () => {
  const statuses = ["ok", "pendingTransfer"];

  it("direction = out（申請を受信）なら承認 / 拒否のみ可", () => {
    const options = { transfer: { direction: "out" } } as const;
    expect(
      isOperationAllowed("transferApprove", statuses, options).allowed,
    ).toBe(true);
    expect(
      isOperationAllowed("transferReject", statuses, options).allowed,
    ).toBe(true);
    for (const op of [
      "renew",
      "update",
      "delete",
      "transferOut",
      "transferIn",
      "transferCancel",
      "authCode",
      "restore",
    ] as const) {
      const check = isOperationAllowed(op, statuses, options);
      expect(check.allowed).toBe(false);
      expect(check.blockedBy).toContain("pendingTransfer");
    }
  });

  it("direction = in（自分が申請）なら取消のみ可", () => {
    const options = { transfer: { direction: "in" } } as const;
    expect(
      isOperationAllowed("transferCancel", statuses, options).allowed,
    ).toBe(true);
    for (const op of [
      "renew",
      "update",
      "delete",
      "transferOut",
      "transferIn",
      "transferApprove",
      "transferReject",
      "authCode",
      "restore",
    ] as const) {
      const check = isOperationAllowed(op, statuses, options);
      expect(check.allowed).toBe(false);
      expect(check.blockedBy).toContain("pendingTransfer");
    }
  });

  it("方向が分からなければ全操作不可（後方互換）", () => {
    for (const op of [
      "renew",
      "transferApprove",
      "transferReject",
      "transferCancel",
    ] as const) {
      const check = isOperationAllowed(op, statuses);
      expect(check.allowed).toBe(false);
      expect(check.blockedBy).toContain("pendingTransfer");
    }
  });

  it("EPP ステータスが未同期でも pending 行があれば方向で判定する", () => {
    expect(
      isOperationAllowed("transferApprove", ["ok"], {
        transfer: { direction: "out" },
      }).allowed,
    ).toBe(true);
    expect(
      isOperationAllowed("renew", ["ok"], { transfer: { direction: "out" } })
        .allowed,
    ).toBe(false);
  });

  it("移管申請が無ければ承認 / 拒否 / 取消はできない", () => {
    for (const op of [
      "transferApprove",
      "transferReject",
      "transferCancel",
    ] as const) {
      const check = isOperationAllowed(op, ["ok"], { transfer: null });
      expect(check.allowed).toBe(false);
      expect(check.blockedBy).toEqual([]);
    }
  });
});

describe("redemptionPeriod / pendingDelete（§11.3）", () => {
  it("RGP 中は復旧以外の操作をブロックする", () => {
    for (const op of [
      "renew",
      "update",
      "delete",
      "transferOut",
      "authCode",
    ] as const) {
      const check = isOperationAllowed(op, ["ok"], {
        rgpStatuses: ["redemptionPeriod"],
      });
      expect(check.allowed).toBe(false);
      expect(check.blockedBy).toContain("redemptionPeriod");
    }
  });

  it("RGP 中は復旧のみ可（pendingDelete と同時でも）", () => {
    expect(
      isOperationAllowed("restore", ["pendingDelete"], {
        rgpStatuses: ["redemptionPeriod"],
      }).allowed,
    ).toBe(true);
  });

  it("pendingDelete のみ（RGP 外）なら復旧も不可", () => {
    const check = isOperationAllowed("restore", ["pendingDelete"], {
      rgpStatuses: ["pendingDelete"],
    });
    expect(check.allowed).toBe(false);
    expect(check.blockedBy).toContain("pendingDelete");
  });

  it("restore は isRestorable に委譲する（RGP でなければ不可）", () => {
    const check = isOperationAllowed("restore", ["ok"], { rgpStatuses: [] });
    expect(check.allowed).toBe(false);
    expect(check.blockedBy).toEqual([]);
    expect(isOperationAllowed("restore", ["redemptionPeriod"]).allowed).toBe(
      true,
    );
  });

  it("rgpStatuses を渡さない既存呼び出しの挙動は変わらない", () => {
    expect(isOperationAllowed("renew", ["ok"]).allowed).toBe(true);
    expect(
      isOperationAllowed("update", ["ok"], { unlockOnly: true }).allowed,
    ).toBe(true);
  });
});

describe("isRestorable（AC-11-2）", () => {
  it("redemptionPeriod のときのみ復旧可", () => {
    expect(isRestorable(["redemptionPeriod"], ["pendingDelete"])).toBe(true);
    expect(isRestorable([], ["ok"])).toBe(false);
    expect(isRestorable([], ["pendingDelete"])).toBe(false);
  });
});
