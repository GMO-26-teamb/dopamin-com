import { RegistryError } from "@dopamin/registry";
import type {
  ApiErrorCode,
  DomainInfo,
  DomainSummary,
  DomainSyncResponse,
} from "@dopamin/shared";
import { splitDomainName } from "@dopamin/shared";
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

/**
 * FR-12 移管 IN の取り込み（§6.5）。承認を検知したあとに `info` を write-through し、
 * `transfers.domain_id` に紐付ける `domains` 行の id を返す。
 *
 * 同名の保有行が他ユーザーのものなら **書き換えずに null を返す**
 * （承認の検知は `info` からの推定なので、推定で他人の保有行を奪わない）。
 * `ownership = transferred_out` の履歴行は同名でも衝突しない（§9.1 の部分一意）。
 */
export async function claimDomainFromInfo(
  userId: string,
  info: DomainInfo,
  syncedAt: Date = new Date(),
): Promise<string | null> {
  return getDomainStore().claimOwned({
    userId,
    name: info.name,
    registry: info.registry,
    ownership: "owned",
    info,
    syncedAt,
  });
}

/** 保有ドメインを DB から削除する（レジストリから即時消滅した場合）。 */
export async function removeDomain(name: string): Promise<void> {
  await getDomainStore().remove(name);
}

/**
 * 所有権チェック（NFR-04 / AC-02-1）。すべてのドメイン操作の入り口で呼ぶ。
 * - 行が無い: 404（このアプリで保有していないドメイン）
 * - 他ユーザーの行: 403（§10.3 の FORBIDDEN = 所有権なし）
 */
export async function requireOwnedDomain(
  userId: string,
  name: string,
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
  return record;
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
