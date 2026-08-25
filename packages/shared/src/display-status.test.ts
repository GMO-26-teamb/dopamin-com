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
      }),
    ).toBe("transferred_out"));
  it("pendingDelete → pending_delete", () =>
    expect(deriveDisplayStatus({ ...base, statuses: ["pendingDelete"] })).toBe(
      "pending_delete",
    ));
  it("redemptionPeriod → rgp", () =>
    expect(
      deriveDisplayStatus({ ...base, rgpStatuses: ["redemptionPeriod"] }),
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
  it("優先順位: pendingDelete > rgp > pendingTransfer > hold > inactive > locked > active", () => {
    expect(
      deriveDisplayStatus({
        ...base,
        statuses: ["pendingDelete", "serverHold"],
        rgpStatuses: ["redemptionPeriod"],
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
