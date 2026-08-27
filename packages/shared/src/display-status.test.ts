import { describe, expect, it } from "vitest";
import { deriveDisplayStatus } from "./display-status";

const base = { statuses: ["ok"], rgpStatuses: [], ownership: "owned" as const };
describe("deriveDisplayStatus", () => {
  it("ok → active", () => expect(deriveDisplayStatus(base)).toBe("active"));
  it("transferred_out は最優先", () =>
    expect(
      deriveDisplayStatus({
        ...base,
        ownership: "transferred_out",
        statuses: ["pendingDelete"],
        rgpStatuses: ["redemptionPeriod"],
      }),
    ).toBe("transferred_out"));
  it("redemptionPeriod を伴わない pendingDelete → pending_delete（AC-11-2）", () =>
    expect(deriveDisplayStatus({ ...base, statuses: ["pendingDelete"] })).toBe(
      "pending_delete",
    ));
  it("redemptionPeriod → rgp", () =>
    expect(
      deriveDisplayStatus({ ...base, rgpStatuses: ["redemptionPeriod"] }),
    ).toBe("rgp"));
  it("mock 形（rgpStatuses に redemptionPeriod + pendingDelete 共存）→ rgp", () =>
    expect(
      deriveDisplayStatus({
        ...base,
        statuses: ["pendingDelete"],
        rgpStatuses: ["redemptionPeriod"],
      }),
    ).toBe("rgp"));
  it("実レジストリ形（statuses 側に redemptionPeriod・rgpStatuses は空）→ rgp", () =>
    expect(
      deriveDisplayStatus({
        ...base,
        statuses: ["pendingDelete", "redemptionPeriod"],
        rgpStatuses: [],
      }),
    ).toBe("rgp"));
  it("pendingTransfer + out → transfer_out_pending", () =>
    expect(
      deriveDisplayStatus({
        ...base,
        statuses: ["pendingTransfer"],
        transfer: { direction: "out" },
      }),
    ).toBe("transfer_out_pending"));
  it("pendingTransfer + in → transfer_in_pending", () =>
    expect(
      deriveDisplayStatus({
        ...base,
        statuses: ["pendingTransfer"],
        transfer: { direction: "in" },
      }),
    ).toBe("transfer_in_pending"));
  it("serverHold → hold", () =>
    expect(deriveDisplayStatus({ ...base, statuses: ["serverHold"] })).toBe(
      "hold",
    ));
  it("inactive → inactive", () =>
    expect(deriveDisplayStatus({ ...base, statuses: ["inactive"] })).toBe(
      "inactive",
    ));
  it("clientTransferProhibited → locked", () =>
    expect(
      deriveDisplayStatus({
        ...base,
        statuses: ["ok", "clientTransferProhibited"],
      }),
    ).toBe("locked"));
  it("優先順位: rgp > pendingDelete > pendingTransfer > hold > inactive > locked > active", () => {
    // RGP 中は EPP 仕様上 pendingDelete が必ず共存する（#171）
    expect(
      deriveDisplayStatus({
        ...base,
        statuses: ["pendingDelete", "serverHold"],
        rgpStatuses: ["redemptionPeriod"],
      }),
    ).toBe("rgp");
    expect(
      deriveDisplayStatus({
        ...base,
        statuses: ["pendingDelete", "serverHold"],
      }),
    ).toBe("pending_delete");
    expect(
      deriveDisplayStatus({
        ...base,
        statuses: ["serverHold", "inactive", "clientDeleteProhibited"],
      }),
    ).toBe("hold");
  });
});
