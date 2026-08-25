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
});

describe("isRestorable（AC-11-2）", () => {
  it("redemptionPeriod のときのみ復旧可", () => {
    expect(isRestorable(["redemptionPeriod"], ["pendingDelete"])).toBe(true);
    expect(isRestorable([], ["ok"])).toBe(false);
    expect(isRestorable([], ["pendingDelete"])).toBe(false);
  });
});
