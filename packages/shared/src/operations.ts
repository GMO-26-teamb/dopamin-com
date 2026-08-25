/**
 * EPP ステータス・所有権・移管方向からの操作可否判定（docs/requirements.md §9.2 / §11.3）。
 * Server ステータスは Client ステータスより優先される（同種があれば両方 blockedBy に入る）。
 */

/**
 * 操作の種別。
 *
 * - `renew` / `update` / `delete` / `transferOut`: 通常操作（§11.3 の各ロックで判定）
 * - `transferIn`: 新規の移管 IN 申請（FR-12）
 * - `transferApprove` / `transferReject`: 受信した OUT 申請への応答（`direction = out`）
 * - `transferCancel`: 自分の IN 申請の取消（`direction = in`）
 * - `authCode`: 移管 OUT 用 AuthCode の取得 / 再発行（§11.3 の移管ロックで判定）
 * - `restore`: RGP 復旧。可否の SSOT は {@link isRestorable}（RGP ベース）で、
 *   `isOperationAllowed` はそこへ委譲したうえで transferred_out / pendingTransfer 等の
 *   横断ルールを重ねて判定する。判定ロジックを二重に持たないため、
 *   RGP そのものの条件を変える場合は {@link isRestorable} だけを変更する。
 */
export type DomainOperation =
  | "renew"
  | "update"
  | "delete"
  | "transferOut"
  | "transferIn"
  | "transferApprove"
  | "transferReject"
  | "transferCancel"
  | "authCode"
  | "restore";

/**
 * どの操作がどの client/server ステータスでブロックされるか。
 * pending 系（pendingTransfer / pendingDelete）と RGP は横断ルールとして別に扱う。
 */
const BLOCKING_STATUSES: Record<DomainOperation, readonly string[]> = {
  renew: ["clientRenewProhibited", "serverRenewProhibited"],
  update: ["clientUpdateProhibited", "serverUpdateProhibited"],
  delete: ["clientDeleteProhibited", "serverDeleteProhibited"],
  // 移管ロックは OUT・新規 IN 申請・AuthCode 取得のいずれも止める（§11.3）
  transferOut: ["clientTransferProhibited", "serverTransferProhibited"],
  transferIn: ["clientTransferProhibited", "serverTransferProhibited"],
  authCode: ["clientTransferProhibited", "serverTransferProhibited"],
  // 移管フロー中の応答・取消と復旧は個別ロックの対象外
  transferApprove: [],
  transferReject: [],
  transferCancel: [],
  restore: [],
};

/** pendingTransfer 中に方向別で許可される操作（§11.3 / AC-07-3）。 */
const TRANSFER_FLOW_OPERATIONS: Record<
  "in" | "out",
  readonly DomainOperation[]
> = {
  // losing（自レジストラがスポンサー）= 申請を受信している側
  out: ["transferApprove", "transferReject"],
  // gaining = 自分が申請した側
  in: ["transferCancel"],
};

const ALL_TRANSFER_FLOW_OPERATIONS: readonly DomainOperation[] = [
  ...TRANSFER_FLOW_OPERATIONS.out,
  ...TRANSFER_FLOW_OPERATIONS.in,
];

/** ownership = transferred_out を blockedBy に載せるための擬似ステータス（EPP ステータスではない）。 */
const TRANSFERRED_OUT = "transferred_out";

export interface OperationCheck {
  allowed: boolean;
  /** ブロックの原因となったステータス（表示用）。 */
  blockedBy: string[];
}

export interface OperationOptions {
  /** §9.1 の所有権。`transferred_out` は表示のみで全操作不可（AC-12-5）。 */
  ownership?: "owned" | "transferred_out";
  /** `transfers` の pending 行（`{ direction }`）。無ければ null / 未指定。 */
  transfer?: { direction: "in" | "out" } | null;
  /** RGP（RFC 3915）ステータス。`redemptionPeriod` 中は復旧のみ可（§11.3）。 */
  rgpStatuses?: readonly string[];
  /** `update` でクライアントステータスの解除だけを行うか。 */
  unlockOnly?: boolean;
}

/**
 * 操作可否を判定する。
 *
 * 要件 §9.2 の表記は `isOperationAllowed(op, statuses, ownership, transfer?)` だが、
 * 実装は第 3 引数を options オブジェクトにしている。理由:
 * - 既存の `unlockOnly` を含めると位置引数が 5 つになり、呼び出し側で順序を誤りやすい
 * - `rgpStatuses` のように後から必要になった入力を後方互換で足せる
 * - `isOperationAllowed(op, statuses)` の 2 引数呼び出し（apps/api）をそのまま通せる
 *
 * 判定順（先に決まったものが優先）:
 * 1. `ownership = transferred_out` → 全操作不可（`blockedBy: ['transferred_out']`、AC-12-5）
 * 2. `pendingTransfer`（EPP ステータス、または pending の移管行）→ 方向別に
 *    `out` は承認 / 拒否、`in` は取消のみ可。方向不明なら全操作不可（AC-07-3）
 * 3. `pendingDelete` → 全操作不可。ただし RGP 中の `restore` だけは可（§11.3）
 * 4. `redemptionPeriod`（`rgpStatuses` / `statuses`）→ 復旧のみ可（§11.3）
 * 5. 操作ごとの client/server ステータス。例外として `update` で `unlockOnly` の場合は
 *    `clientUpdateProhibited` があっても許可する（ロック解除の経路を残すため。Server 側は不可）
 *
 * 移管申請が無い状態での `transferApprove` / `transferReject` / `transferCancel` は
 * 原因となるステータスが無いため `{ allowed: false, blockedBy: [] }` を返す。
 */
export function isOperationAllowed(
  op: DomainOperation,
  statuses: readonly string[],
  options?: OperationOptions,
): OperationCheck {
  const rgpStatuses = options?.rgpStatuses ?? [];
  const direction = options?.transfer?.direction ?? null;
  const blockedBy = new Set<string>();

  // 1. 移管 OUT 完了後は EPP ステータスに関わらず全操作不可（AC-12-5）
  if (options?.ownership === "transferred_out") {
    return { allowed: false, blockedBy: [TRANSFERRED_OUT] };
  }

  // 2. 移管中は方向に応じた操作だけ許可（AC-07-3）
  const pendingTransfer =
    statuses.includes("pendingTransfer") || direction !== null;
  if (pendingTransfer) {
    if (
      direction !== null &&
      TRANSFER_FLOW_OPERATIONS[direction].includes(op)
    ) {
      return { allowed: true, blockedBy: [] };
    }
    blockedBy.add("pendingTransfer");
  } else if (ALL_TRANSFER_FLOW_OPERATIONS.includes(op)) {
    // 対象の移管申請が無ければ承認 / 拒否 / 取消はできない
    return { allowed: false, blockedBy: [] };
  }

  const restorable = isRestorable(rgpStatuses, statuses);

  // 3. 削除待ちは全操作不可。RGP 中の復旧だけは残す（§11.3）
  if (statuses.includes("pendingDelete") && !(op === "restore" && restorable)) {
    blockedBy.add("pendingDelete");
  }

  // 4. RGP 中は復旧のみ可（§11.3）
  if (op !== "restore" && isInRedemptionPeriod(rgpStatuses, statuses)) {
    blockedBy.add("redemptionPeriod");
  }

  // 5. 復旧の可否そのものは isRestorable が SSOT
  if (op === "restore") {
    return {
      allowed: restorable && blockedBy.size === 0,
      blockedBy: [...blockedBy],
    };
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

function isInRedemptionPeriod(
  rgpStatuses: readonly string[],
  statuses: readonly string[],
): boolean {
  return (
    rgpStatuses.includes("redemptionPeriod") ||
    statuses.includes("redemptionPeriod")
  );
}

/** 復旧（RGP restore）が可能か。redemptionPeriod 中のみ可（AC-11-2）。 */
export function isRestorable(
  rgpStatuses: readonly string[],
  statuses: readonly string[],
): boolean {
  return isInRedemptionPeriod(rgpStatuses, statuses);
}
