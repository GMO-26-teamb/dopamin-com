import { RegistryError } from "@dopamin/registry";
import {
  type ApiErrorCode,
  type DomainInfo,
  type DomainOperation,
  type DomainSummary,
  type DomainSyncResponse,
  isOperationAllowed,
  splitDomainName,
} from "@dopamin/shared";
import { ApiException } from "../lib/errors";
import { adapterForDomain } from "../lib/registries";
import { registryErrorMessage } from "../lib/registry-message";
import { type DomainRecord, getDomainStore } from "./domain-store";

/**
 * 保有ドメインの write-through（docs/requirements.md §6.5）。
 * レジストリが正なので、`info` / 更新系の結果を受け取るたびに DB キャッシュを上書きする。
 */
export async function upsertDomainFromInfo(
  userId: string,
  info: DomainInfo,
  syncedAt: Date = new Date(),
): Promise<DomainRecord> {
  return getDomainStore().upsert({
    userId,
    name: info.name,
    registry: info.registry,
    // `info` が返るのは保有中の行だけ。移管 OUT の検知は #57 / #58 が別経路で行う
    ownership: "owned",
    info,
    syncedAt,
  });
}

/** 保有ドメインを DB から削除する（レジストリから即時消滅した場合）。 */
export async function removeDomain(name: string): Promise<void> {
  await getDomainStore().remove(name);
}

export interface RequireOwnedDomainOptions {
  /**
   * 書き込み系（renew / update / delete / restore / auth-code など）の入り口か。
   * true のとき `ownership = 'transferred_out'` の行を 409 で止める（AC-12-5）。
   * 参照系（詳細表示）は移管済みでも通す（「表示のみ」の S-34）。
   */
  forWrite?: boolean;
}

/**
 * 所有権チェック（NFR-04 / AC-02-1 / AC-12-5）。すべてのドメイン操作の入り口で呼ぶ。
 * - 行が無い: 404（このアプリで保有していないドメイン）
 * - 他ユーザーの行: 403（§10.3 の FORBIDDEN = 所有権なし）
 * - 移管 OUT 済みの行への書き込み: 409（`forWrite` 指定時のみ）
 *
 * レジストリに問い合わせる前に呼ぶ。移管 OUT 済みのドメインは自レジストラがスポンサーでは
 * ないため、`info` の応答が当てにならない（要確認 §21.2 #12）。
 */
export async function requireOwnedDomain(
  userId: string,
  name: string,
  options: RequireOwnedDomainOptions = {},
): Promise<DomainRecord> {
  const record = await getDomainStore().find(name);
  if (!record) {
    throw new ApiException(
      "NOT_FOUND",
      "保有ドメインに見つかりません。ダッシュボードの「最新化」をお試しください。",
    );
  }
  if (record.userId !== userId) {
    throw new ApiException(
      "FORBIDDEN",
      "このドメインを操作する権限がありません。",
    );
  }
  if (options.forWrite) {
    assertWritableOwnership(record);
  }
  return record;
}

/**
 * 移管系（FR-12）の所有権チェック。
 *
 * 移管 IN の対象ドメインは承認を検知するまで `domains` 行を持たない（§FR-12）ので、
 * 行が無いことは正常として通す（ここで 404 にすると移管 IN そのものができない）。
 * 止めるのは他ユーザーが保有中の行への操作だけ。他ユーザーの `transferred_out` 行は
 * 既に自レジストラのスポンサー下に無く、誰が移管 IN しても構わないため通す。
 */
export async function requireNotOwnedByOtherUser(
  userId: string,
  name: string,
): Promise<DomainRecord | null> {
  const record = await getDomainStore().find(name);
  if (record && record.ownership === "owned" && record.userId !== userId) {
    throw new ApiException(
      "FORBIDDEN",
      "このドメインを操作する権限がありません。",
    );
  }
  return record;
}

/**
 * 所有権由来の可否だけを判定するための代表操作。
 * `transferred_out` は判定順 1 で早期 return されるため操作によらず不可になる。
 * `owned` 側で素通しさせたいので、対象の申請が無いと不可になる移管フロー操作
 * （`transferApprove` / `transferReject` / `transferCancel`）と、RGP が前提の `restore` は使えない。
 */
const OWNERSHIP_GUARD_OPERATION: DomainOperation = "update";

/**
 * ステータス由来の可否は各ルートがレジストリの最新 `info` で判定する（キャッシュでは判定しない）。
 * ここに空配列を渡すことで、判定を所有権だけに限定する。
 */
const NO_STATUSES: readonly string[] = [];

/**
 * AC-12-5: 移管 OUT が完了した行は表示のみで、書き込み系は 409 `OPERATION_NOT_ALLOWED`。
 * 可否の SSOT は `@dopamin/shared` の `isOperationAllowed`（#24）に委譲する。
 */
function assertWritableOwnership(record: DomainRecord): void {
  const check = isOperationAllowed(OWNERSHIP_GUARD_OPERATION, NO_STATUSES, {
    ownership: record.ownership,
  });
  if (check.allowed) {
    return;
  }
  throw new ApiException(
    "OPERATION_NOT_ALLOWED",
    "移管が完了したドメインのため操作できません（表示のみ）。",
    // `statuses` は §10.3 の OPERATION_NOT_ALLOWED 共通形（UI がそのまま表示する）。
    // `reason` は EPP ステータスではない理由（移管済み）を区別するため。
    { reason: record.ownership, statuses: check.blockedBy },
  );
}

/**
 * DB の行を一覧・詳細用の要約に写像する（FR-02）。
 *
 * `rgpUntil` は両レジストリの `info` が猶予期限を返さないため常に null
 * （§11.4 の目安日数からの算出は UI 側の責務）。`transfer` は移管一覧（FR-12）が入るまで null。
 */
export function toDomainSummary(
  record: DomainRecord,
  stale: boolean,
): DomainSummary {
  const { sld, tld } = splitDomainName(record.name);
  const { info } = record;
  return {
    name: record.name,
    sld,
    tld,
    registry: record.registry,
    statuses: info.statuses,
    rgpStatuses: info.rgpStatuses,
    ownership: record.ownership,
    registeredAt: info.registeredAt,
    expiresAt: info.expiresAt,
    rgpUntil: null,
    syncedAt: record.syncedAt.toISOString(),
    stale,
    transfer: null,
  };
}

/** FR-02: 保有ドメイン一覧（DB キャッシュを読むだけ。レジストリには問い合わせない）。 */
export async function listDomainSummaries(
  userId: string,
): Promise<DomainSummary[]> {
  const records = await getDomainStore().list(userId);
  return records.map((record) => toDomainSummary(record, false));
}

/**
 * 同期の失敗を一覧用の項目に変換する。
 * レジストリ由来は正規化コードとユーザー向け文言、TLD 表の変更などで
 * アダプタを引けなかった場合（ApiException）はそのコードをそのまま残す。
 */
function toSyncFailure(
  name: string,
  err: unknown,
): DomainSyncResponse["failures"][number] {
  if (err instanceof RegistryError) {
    return {
      name,
      code: err.code as ApiErrorCode,
      message: registryErrorMessage(err),
    };
  }
  if (err instanceof ApiException) {
    return { name, code: err.code, message: err.message };
  }
  return { name, code: "INTERNAL", message: "同期に失敗しました。" };
}

/**
 * FR-02: 全保有ドメインを `info` で再同期する。
 *
 * 1 件の失敗で全体を落とさず、失敗した行はキャッシュを `stale: true` で返す（AC-03-2 と同じ方針）。
 *
 * 【未実装・意図的な制約】
 * - Poll の消化（§10.1「同時に Poll も消化する」）は、アダプタに `poll` / `ackMessage` が
 *   入る #44 と Poll サービス #58 で足す。
 * - AC-02-4（移管 OUT 完了後に保有一覧から消える）は満たしていない。`ownership` 列（#33）は
 *   入ったが、それを `transferred_out` に遷移させる移管の永続化（#56 / #57）と Poll 消化（#58）が
 *   無いため、この関数は保有／非保有を判定できない。
 *   `info` が NOT_FOUND を返しても **行は消さない**（失敗一覧にコードを載せるだけ）。
 *   非スポンサーからの `info` の応答が未確定（要確認 §21.2 #12）な段階で行を消すと、
 *   一時的な誤判定でユーザーのドメインが一覧から消える方が実害が大きいため。
 */
export async function syncDomains(userId: string): Promise<DomainSyncResponse> {
  const records = await getDomainStore().list(userId);
  const failures: DomainSyncResponse["failures"] = [];

  const domains = await Promise.all(
    records.map(async (record): Promise<DomainSummary> => {
      // AC-12-5: 移管 OUT 済みの行は再同期しない。info を引いて write-through すると
      // ownership が owned に戻り、書き込み禁止（#54）が外れてしまう
      if (record.ownership !== "owned") {
        return toDomainSummary(record, false);
      }
      try {
        const info = await adapterForDomain(record.name).info(record.name);
        const updated = await upsertDomainFromInfo(userId, info);
        return toDomainSummary(updated, false);
      } catch (err) {
        failures.push(toSyncFailure(record.name, err));
        return toDomainSummary(record, true);
      }
    }),
  );

  return { domains, failures };
}
