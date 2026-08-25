import type { DisplayStatus } from "@dopamin/shared";
import { DISPLAY_STATUS_LABEL } from "@dopamin/shared";
import { describe, expect, it } from "vitest";
import {
  statusBadgeTone,
  statusBadgeVariant,
  statusLabel,
} from "./status-badge";

/** ui-screens §2.2「Domain Card の Status」表の Tone 列。 */
const EXPECTED: Record<DisplayStatus, string> = {
  active: "ok",
  rgp: "warn",
  pending_delete: "muted",
  transfer_in_pending: "muted",
  transfer_out_pending: "muted",
  transferred_out: "muted",
  hold: "warn",
  inactive: "neutral",
  locked: "neutral",
};

describe("statusBadgeTone", () => {
  it("ui-screens §2.2 の Tone 表に 1:1（ダッシュボードと詳細で同じ）", () => {
    for (const [status, tone] of Object.entries(EXPECTED)) {
      expect(statusBadgeTone(status as DisplayStatus), status).toBe(tone);
    }
  });

  it("すべての DisplayStatus を網羅する", () => {
    expect(Object.keys(EXPECTED)).toHaveLength(
      Object.keys(DISPLAY_STATUS_LABEL).length,
    );
  });
});

describe("statusBadgeVariant", () => {
  it("削除待ちだけ Solid、ほかは Outline（§2.2）", () => {
    expect(statusBadgeVariant("pending_delete")).toBe("solid");
    for (const status of Object.keys(EXPECTED) as DisplayStatus[]) {
      if (status !== "pending_delete") {
        expect(statusBadgeVariant(status), status).toBe("outline");
      }
    }
  });
});

describe("statusLabel", () => {
  it("shared の DISPLAY_STATUS_LABEL をそのまま使う", () => {
    expect(statusLabel("active")).toBe(DISPLAY_STATUS_LABEL.active);
    expect(statusLabel("pending_delete")).toBe(
      DISPLAY_STATUS_LABEL.pending_delete,
    );
  });
});
