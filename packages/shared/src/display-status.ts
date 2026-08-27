/**
 * EPP ステータス・RGP・所有権・移管情報から画面表示用のステータスを導出する（docs/requirements.md §9.2 / §11.3）。
 *
 * 優先順位（§9.2）:
 * transferred_out（ownership）> redemptionPeriod（RGP）> pendingDelete（statuses）
 * > pendingTransfer（statuses・direction で in/out を分岐）> hold（client/serverHold）
 * > inactive > locked（client*Prohibited / server*Prohibited）> active
 *
 * RGP を `pendingDelete` より先に見るのは、RFC 3915 の RGP 中は EPP の `pendingDelete` が
 * 必ず共存するため（先に `pendingDelete` を見ると `rgp` に到達しない・#171）。`redemptionPeriod`
 * を伴わない `pendingDelete`（RGP 経過後の完全削除待ち）だけが `pending_delete` になる（AC-11-2）。
 * RGP 中かどうかの判定は {@link isInRedemptionPeriod} が SSOT で、ここでは再実装しない。
 */

import { isInRedemptionPeriod } from "./operations";

export type DisplayStatus =
  | "active"
  | "rgp"
  | "pending_delete"
  | "transfer_in_pending"
  | "transfer_out_pending"
  | "transferred_out"
  | "hold"
  | "inactive"
  | "locked";

export interface DeriveDisplayStatusInput {
  statuses: readonly string[];
  rgpStatuses: readonly string[];
  ownership: "owned" | "transferred_out";
  transfer?: { direction: "in" | "out" } | null;
}

export const DISPLAY_STATUS_LABEL: Record<DisplayStatus, string> = {
  active: "Active",
  rgp: "復旧猶予",
  pending_delete: "削除待ち",
  transfer_in_pending: "移管申請中",
  transfer_out_pending: "移管中（申請受信）",
  transferred_out: "移管済み",
  hold: "停止中",
  inactive: "NS 未設定",
  locked: "ロック中",
};

const HOLD_STATUSES = ["clientHold", "serverHold"];

/** client*Prohibited / server*Prohibited を網羅的に判定する（§11.3 のロック系ステータス全般）。 */
const PROHIBITED_PATTERN = /^(client|server)\w*Prohibited$/;

export function deriveDisplayStatus(
  input: DeriveDisplayStatusInput,
): DisplayStatus {
  const { statuses, rgpStatuses, ownership, transfer } = input;

  if (ownership === "transferred_out") {
    return "transferred_out";
  }
  // RGP 中は pendingDelete が共存するので、pendingDelete より先に判定する（#171）
  if (isInRedemptionPeriod(rgpStatuses, statuses)) {
    return "rgp";
  }
  if (statuses.includes("pendingDelete")) {
    return "pending_delete";
  }
  if (statuses.includes("pendingTransfer")) {
    if (transfer?.direction === "out") {
      return "transfer_out_pending";
    }
    if (transfer?.direction === "in") {
      return "transfer_in_pending";
    }
  }
  if (statuses.some((status) => HOLD_STATUSES.includes(status))) {
    return "hold";
  }
  if (statuses.includes("inactive")) {
    return "inactive";
  }
  if (statuses.some((status) => PROHIBITED_PATTERN.test(status))) {
    return "locked";
  }
  return "active";
}
