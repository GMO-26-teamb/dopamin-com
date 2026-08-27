/**
 * 操作パネル（S-30 右）の可否と理由（AC-07-1）。
 *
 * 可否判定は `packages/shared` の `isOperationAllowed`（復旧は `isRestorable`）が SSOT。
 * ここは「ブロックしたステータス → 画面に出す理由（1 語）」の対応だけを持つ。
 * 理由はボタンのラベルには連結しない（連結すると「廃止 — 削除ロック中」のような
 * 長いラベルになり、何のボタンか読み取れなくなる）。ラベルは操作名のままにして、
 * 理由はボタンの下に別の 1 行として出す。
 */

import type { DomainOperation } from "@dopamin/shared";
import { isOperationAllowed } from "@dopamin/shared";
import type { DomainDetail } from "@/lib/api/types";

/** 操作パネルが扱う 5 操作（`DomainOperation` の部分集合）。 */
export type DetailOperation = Extract<
  DomainOperation,
  "renew" | "update" | "delete" | "transferOut" | "restore"
>;

/** ステータスごとの理由（Server > Client の順で選ぶ）。 */
const REASON_BY_STATUS: Record<string, string> = {
  transferred_out: "移管済みのため不可",
  pendingDelete: "削除処理中のため不可",
  pendingTransfer: "移管申請中のため不可",
  redemptionPeriod: "復旧猶予（RGP）中のため不可",
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
  "transferred_out",
  "pendingDelete",
  "pendingTransfer",
  "redemptionPeriod",
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
  // 所有権・移管方向・RGP を含めて `isOperationAllowed` に委譲する（SHARED-02）。
  // 以前はここで displayStatus === "rgp" を見ていたが、rgpStatuses を渡せば shared 側で判定できる。
  const check = isOperationAllowed(op, domain.statuses, {
    ownership: domain.ownership,
    transfer: domain.transfer,
    rgpStatuses: domain.rgpStatuses,
  });
  if (check.allowed) {
    return ALLOWED;
  }
  // 復旧は RGP でないだけなら原因ステータスが無い（isRestorable が SSOT）
  if (op === "restore" && check.blockedBy.length === 0) {
    return { allowed: false, reason: "RGP ではないため不可", blockedBy: [] };
  }
  return {
    allowed: false,
    reason: reasonFrom(check.blockedBy),
    blockedBy: check.blockedBy,
  };
}
