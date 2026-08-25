/**
 * EPP ステータスからの操作可否判定（docs/requirements.md §9.2 / §11.3）。
 * Server ステータスは Client ステータスより優先される（同種があれば両方 blockedBy に入る）。
 */

/**
 * 通常操作の種別。restore はここに含めない —
 * restore は削除後（pendingDelete / redemptionPeriod）にのみ行う操作であり、
 * 可否は isRestorable（RGP ベース）で判定する。
 */
export type DomainOperation = "renew" | "update" | "delete" | "transferOut";

/** どの操作がどのステータスでブロックされるか。pending 系は全操作をブロックする。 */
const BLOCKING_STATUSES: Record<DomainOperation, readonly string[]> = {
  renew: ["clientRenewProhibited", "serverRenewProhibited"],
  update: ["clientUpdateProhibited", "serverUpdateProhibited"],
  delete: ["clientDeleteProhibited", "serverDeleteProhibited"],
  transferOut: ["clientTransferProhibited", "serverTransferProhibited"],
};

const PENDING_STATUSES = ["pendingTransfer", "pendingDelete"] as const;

export interface OperationCheck {
  allowed: boolean;
  /** ブロックの原因となったステータス（表示用）。 */
  blockedBy: string[];
}

/**
 * 操作可否を判定する。
 * 例外: `update` でクライアントステータスの解除だけを行う場合は
 * `clientUpdateProhibited` があっても許可される（ロック解除の経路を残すため）。
 */
export function isOperationAllowed(
  op: DomainOperation,
  statuses: readonly string[],
  options?: { unlockOnly?: boolean },
): OperationCheck {
  const blockedBy = new Set<string>();

  for (const status of PENDING_STATUSES) {
    if (statuses.includes(status)) {
      blockedBy.add(status);
    }
  }

  for (const status of BLOCKING_STATUSES[op]) {
    if (!statuses.includes(status)) {
      continue;
    }
    if (
      op === "update" &&
      status === "clientUpdateProhibited" &&
      options?.unlockOnly
    ) {
      continue;
    }
    blockedBy.add(status);
  }

  return { allowed: blockedBy.size === 0, blockedBy: [...blockedBy] };
}

/** 復旧（RGP restore）が可能か。redemptionPeriod 中のみ可（AC-11-2）。 */
export function isRestorable(
  rgpStatuses: readonly string[],
  statuses: readonly string[],
): boolean {
  return (
    rgpStatuses.includes("redemptionPeriod") ||
    statuses.includes("redemptionPeriod")
  );
}
