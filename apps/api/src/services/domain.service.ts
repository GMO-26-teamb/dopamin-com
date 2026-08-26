import { RegistryError } from "@dopamin/registry";
import type {
  ApiErrorCode,
  DomainInfo,
  DomainSummary,
  DomainSyncResponse,
} from "@dopamin/shared";
import { isOperationAllowed, splitDomainName } from "@dopamin/shared";
import { ApiException } from "../lib/errors";
import { adapterForDomain } from "../lib/registries";
import { registryErrorMessage } from "../lib/registry-message";
import { type DomainRecord, getDomainStore } from "./domain-store";
import { getTransferStore, type TransferRecord } from "./transfer-store";

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
   * 更新系（renew / update / delete / restore / authCode / 移管の承認・拒否）か。
   * true のときだけ `ownership = 'transferred_out'` を 409 で弾く（AC-12-5）。
   * 参照系（詳細表示）は移管 OUT 済みの行も読めないと履歴が見えなくなるので false のまま。
   */
  forWrite?: boolean;
}

/**
 * 所有権チェック（NFR-04 / AC-02-1 / AC-12-5）。すべてのドメイン操作の入り口で呼ぶ。
 * - 行が無い: 404（このアプリで保有していないドメイン）
 * - 他ユーザーの行: 403（§10.3 の FORBIDDEN = 所有権なし）
 * - `transferred_out` の行への更新系: 409（§11.3。可否の判定は `isOperationAllowed` が SSOT）
 *
 * 409 はレジストリに問い合わせる前に返す。移管 OUT 済みのドメインは自レジストラが
 * スポンサーではなく、`info` の応答が未確定（【要確認 §21.2 #12】）なので、
 * 呼びに行っても結果を信頼できないため。
 */
export async function requireOwnedDomain(
  userId: string,
  name: string,
  options?: RequireOwnedDomainOptions,
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
  if (options?.forWrite) {
    // EPP ステータスは見ない（レジストリ未問い合わせ）。ownership だけで決まる判定を
    // ここに閉じ込め、ステータス由来の可否は各ルートが info 取得後に改めて判定する。
    const check = isOperationAllowed("update", [], {
      ownership: record.ownership,
    });
    if (!check.allowed) {
      throw new ApiException(
        "OPERATION_NOT_ALLOWED",
        "このドメインは他社へ移管済みのため操作できません。",
        { reason: "transferred_out", statuses: check.blockedBy },
      );
    }
  }
  return record;
}

/**
 * 進行中の移管 → 一覧・詳細の移管バッジ（§10.4 `transfer`）。
 * `actByAt` はサーバ自動承認の期限で、レジストリが `acDate` を返さない場合は
 * 申請 + 20 分が入っている（§9.2 / `recordInboundTransferRequest`）。
 */
function toTransferBadge(
  transfer: TransferRecord | undefined,
): DomainSummary["transfer"] {
  if (transfer === undefined || transfer.actByAt === null) {
    return null;
  }
  return {
    direction: transfer.direction,
    actByAt: transfer.actByAt.toISOString(),
  };
}

/**
 * DB の行を一覧・詳細用の要約に写像する（FR-02）。
 *
 * `rgpUntil` は両レジストリの `info` が猶予期限を返さないため常に null
 * （§11.4 の目安日数からの算出は UI 側の責務）。
 * `transfer` は進行中の移管があれば入る（FR-12 / AC-07-3）。
 */
export function toDomainSummary(
  record: DomainRecord,
  stale: boolean,
  transfer?: TransferRecord,
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
    transfer: toTransferBadge(transfer),
  };
}

/**
 * ユーザーの進行中の移管をドメイン名で引ける形にする。
 * 同じドメインに pending が複数ある状態は本来起きないので、新しい方を採る。
 */
export async function pendingTransfersByDomain(
  userId: string,
): Promise<Map<string, TransferRecord>> {
  const pending = await getTransferStore().listPending(userId);
  const byName = new Map<string, TransferRecord>();
  for (const transfer of pending) {
    if (!byName.has(transfer.domainName)) {
      byName.set(transfer.domainName, transfer);
    }
  }
  return byName;
}

/** FR-02: 保有ドメイン一覧（DB キャッシュを読むだけ。レジストリには問い合わせない）。 */
export async function listDomainSummaries(
  userId: string,
): Promise<DomainSummary[]> {
  const [records, transfers] = await Promise.all([
    getDomainStore().list(userId),
    pendingTransfersByDomain(userId),
  ]);
  return records.map((record) =>
    toDomainSummary(record, false, transfers.get(record.name)),
  );
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
 * 対象は `ownership = 'owned'` の行だけ（`DomainStore.list` が絞る）。移管 OUT 済みの行は
 * 自レジストラがスポンサーではなく `info` の応答を信頼できないので、再同期しない。
 *
 * 移管の検知（`pendingTransfer` / スポンサー変更）は `onSynced` フックに切り出してある。
 * Poll 消化（#58）と同じサービスから差し込むためで、こうしないと
 * domain.service ↔ transfer.service が循環参照になる。
 *
 * 【未実装・意図的な制約】
 * - `info` が NOT_FOUND を返しても **行は消さない**（失敗一覧にコードを載せるだけ）。
 *   非スポンサーからの `info` の応答が未確定（要確認 §21.2 #12）な段階で行を消すと、
 *   一時的な誤判定でユーザーのドメインが一覧から消える方が実害が大きいため。
 */
export interface SyncDomainsOptions {
  /**
   * `info` が取れた行ごとに呼ばれるフック（移管の検知を差し込む口）。
   * 例外は同期本体に伝播させない: 付随処理の失敗で一覧が壊れる方が実害が大きいので、
   * 呼び出し側が握りつぶす前提で使う。
   */
  onSynced?: (record: DomainRecord, info: DomainInfo) => Promise<void>;
}

export async function syncDomains(
  userId: string,
  options: SyncDomainsOptions = {},
): Promise<DomainSyncResponse> {
  const records = await getDomainStore().list(userId);
  const failures: DomainSyncResponse["failures"] = [];

  await Promise.all(
    records.map(async (record) => {
      try {
        const info = await adapterForDomain(record.name).info(record.name);
        const updated = await upsertDomainFromInfo(userId, info);
        await options.onSynced?.(updated, info);
      } catch (err) {
        failures.push(toSyncFailure(record.name, err));
      }
    }),
  );

  // 同期と onSynced（移管の検知）が終わってから読み直す。
  // 移管 OUT に倒れた行はここで一覧から外れる（AC-02-4）。
  // 失敗した行は DB キャッシュのまま残るので stale: true で返す
  const [stillOwned, transfers] = await Promise.all([
    getDomainStore().list(userId),
    pendingTransfersByDomain(userId),
  ]);
  const failedNames = new Set(failures.map((f) => f.name));
  const domains = stillOwned.map((record) =>
    toDomainSummary(
      record,
      failedNames.has(record.name),
      transfers.get(record.name),
    ),
  );
  return { domains, failures };
}
