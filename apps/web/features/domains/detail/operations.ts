/**
 * 操作パネル（S-30 右）の可否と理由（AC-07-1）。
 *
 * 可否判定は `packages/shared` の `isOperationAllowed` / `isRestorable` が SSOT。
 * ここは「ブロックしたステータス → 画面に出す理由（1 語）」の対応だけを持つ。
 * Figma の Disabled ラベルは「廃止 — 削除ロック中」のように理由を併記する。
 */

import type { DomainOperation } from "@dopamin/shared";
import { isOperationAllowed, isRestorable } from "@dopamin/shared";
import type { DomainDetail } from "@/lib/api/types";

export type DetailOperation = DomainOperation | "restore";

/** ステータスごとの理由（Server > Client の順で選ぶ）。 */
const REASON_BY_STATUS: Record<string, string> = {
  pendingDelete: "削除処理中のため不可",
  pendingTransfer: "移管申請中のため不可",
  serverRenewProhibited: "更新ロック中",
  clientRenewProhibited: "更新ロック中",
  serverUpdateProhibited: "変更ロック中",
  clientUpdateProhibited: "変更ロック中",
  serverDeleteProhibited: "削除ロック中",
  clientDeleteProhibited: "削除ロック中",
  serverTransferProhibited: "移管ロック中",
  clientTransferProhibited: "移管ロック中",
};

/** 理由の優先順位（先に見つかったものを出す）。Server > Client、pending 系が最優先。 */
const REASON_PRIORITY = [
  "pendingDelete",
  "pendingTransfer",
  "serverRenewProhibited",
  "serverUpdateProhibited",
  "serverDeleteProhibited",
  "serverTransferProhibited",
  "clientRenewProhibited",
  "clientUpdateProhibited",
  "clientDeleteProhibited",
  "clientTransferProhibited",
] as const;

export interface OperationState {
  allowed: boolean;
  /** 不可の理由（1 語）。可能なときは null。 */
  reason: string | null;
  /** 理由の根拠になった EPP ステータス（ツールチップ用）。 */
  blockedBy: string[];
}

const ALLOWED: OperationState = { allowed: true, reason: null, blockedBy: [] };

function reasonFrom(blockedBy: readonly string[]): string {
  for (const status of REASON_PRIORITY) {
    if (blockedBy.includes(status)) {
      return REASON_BY_STATUS[status] ?? "実行できません";
    }
  }
  return "実行できません";
}

/**
 * 1 操作の可否。`stale` が true（S-31）のときは、キャッシュ表示のため全操作を止める。
 * `transferred_out`（S-34）/ `pending_delete`（S-36）は呼び出し側でパネルごと出さない。
 */
export function operationState(
  domain: DomainDetail,
  op: DetailOperation,
): OperationState {
  if (domain.stale) {
    return { allowed: false, reason: "再同期が必要", blockedBy: [] };
  }
  if (domain.ownership === "transferred_out") {
    return { allowed: false, reason: "移管済みのため不可", blockedBy: [] };
  }
  if (op === "restore") {
    return isRestorable(domain.rgpStatuses, domain.statuses)
      ? ALLOWED
      : { allowed: false, reason: "RGP ではないため不可", blockedBy: [] };
  }
  // §11.3: redemptionPeriod は「復旧のみ可」。`redemptionPeriod` は `rgpStatuses` 側に来るため
  // `isOperationAllowed`（statuses だけを見る）では拾えない。判定は displayStatus（SSOT）で行う。
  if (domain.displayStatus === "rgp") {
    return {
      allowed: false,
      reason: "復旧猶予（RGP）中のため不可",
      blockedBy: ["redemptionPeriod"],
    };
  }
  const check = isOperationAllowed(op, domain.statuses);
  return check.allowed
    ? ALLOWED
    : {
        allowed: false,
        reason: reasonFrom(check.blockedBy),
        blockedBy: check.blockedBy,
      };
}

/** ボタンのラベル。不可のときは Figma どおり「廃止 — 削除ロック中」の形にする。 */
export function operationLabel(base: string, state: OperationState): string {
  return state.allowed || state.reason === null
    ? base
    : `${base} — ${state.reason}`;
}
