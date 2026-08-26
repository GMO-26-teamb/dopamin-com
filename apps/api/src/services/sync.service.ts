import type { Db } from "@dopamin/db";
import type { RegistryAdapter } from "@dopamin/registry";
import type {
  DomainInfo,
  DomainSummary,
  DomainSyncResponse,
} from "@dopamin/shared";
import { adapterForDomain } from "../lib/registries";
import {
  listOwnedDomainRecords,
  markDomainTransferredOut,
  toDomainSummary,
  toSyncFailure,
  upsertDomainFromInfo,
} from "./domain.service";
import type { DomainRecord } from "./domain-store";
import { consumePollSafely } from "./poll.service";
import { recordOutboundTransferRequest } from "./transfer.service";

/**
 * FR-02 の最新化（`POST /domains/sync`）。保有ドメインを `info` で再同期しつつ、
 * §10.1 のとおり **同時に Poll も消化する**（FR-12）。
 *
 * `domains`（domain.service）と `transfers`（transfer.service）と Poll（poll.service）に
 * またがる横断処理なので、どれか 1 つのサービスに置くと循環参照になる。
 * ここは「複数サービスを束ねるユースケース」の層として独立させている。
 */

/**
 * 受信した移管申請を `info` からも拾う（FR-12「`info` で `pendingTransfer` を検知した
 * 場合も同様に `transfers(out)` を作る」）。
 *
 * Poll の通知を取りこぼしても、保有ドメインが `pendingTransfer` になっていれば
 * 「誰かが移管を申請している」ことは分かる。相手レジストラ ID や申請日時は
 * `transferQuery` から取れるだけ取り、取れなければ検知時刻で埋める。
 *
 * この関数が見るのは **保有中（`ownership = owned`）の行だけ**。自レジストラが
 * スポンサーである以上、その `pendingTransfer` は必ず移管 OUT（受信した申請）で、
 * 自分が出した移管 IN の申請は `domains` 行を持たない（§6.5）。
 */
async function recordOutboundTransferFromInfo(
  db: Db,
  adapter: RegistryAdapter,
  record: DomainRecord,
  now: Date,
): Promise<void> {
  const queried = await adapter.transferQuery(record.name);
  if (queried.status !== "pending") {
    return;
  }
  await recordOutboundTransferRequest(db, {
    userId: record.userId,
    domainId: record.id ?? null,
    name: record.name,
    registry: adapter.id,
    selfRegistrarId: adapter.registrarId,
    result: queried,
    // Poll 由来ではないので冪等キーは持たない。あとで同じ移管の通知が届いたら
    // その通知 ID をこの行に刻む（recordOutboundTransferRequest の突合ルール）
    registryMessageId: null,
    fallbackRequestedAt: now,
    now,
  });
}

/**
 * 移管 OUT が完了しているか（§6.5）。`info` の clID（`sponsoringRegistrarId`）が
 * 自レジストラでなければ、そのドメインはもう自分のものではない。
 *
 * 両レジストリの `info` 応答に clID が無いため実レジストリでは当面つねに null になり、
 * この判定は効かない【要確認: §21.2 #12】。移管 OUT の検知は当面 Poll が主体で、
 * ここは clID が返るようになったときに効き始める保険。
 */
function isTransferredOut(info: DomainInfo, adapter: RegistryAdapter): boolean {
  return (
    info.sponsoringRegistrarId !== null &&
    info.sponsoringRegistrarId !== adapter.registrarId
  );
}

/**
 * FR-02 / FR-12: 全保有ドメインを `info` で再同期し、Poll を消化する。
 *
 * 1 件の失敗で全体を落とさず、失敗した行はキャッシュを `stale: true` で返す
 * （AC-03-2 と同じ方針）。移管 OUT 済みと判明した行は `transferred_out` に倒して
 * 応答から外す（AC-02-4）。
 *
 * `info` が NOT_FOUND を返しても **行は消さない**（失敗一覧にコードを載せるだけ）。
 * 非スポンサーからの `info` の応答が未確定な段階で行を消すと、一時的な誤判定で
 * ユーザーのドメインが一覧から消える方が実害が大きいため。
 */
export async function syncDomains(
  db: Db,
  userId: string,
): Promise<DomainSyncResponse> {
  const records = await listOwnedDomainRecords(userId);
  const failures: DomainSyncResponse["failures"] = [];
  const now = new Date();

  const synced = await Promise.all(
    records.map(async (record): Promise<DomainSummary | null> => {
      try {
        const adapter = adapterForDomain(record.name);
        const info = await adapter.info(record.name);
        const updated = await upsertDomainFromInfo(userId, info, now);
        if (isTransferredOut(info, adapter)) {
          await markDomainTransferredOut(record.name, now);
          // AC-02-4: 移管 OUT 完了後は保有一覧から消える
          return null;
        }
        if (info.statuses.includes("pendingTransfer")) {
          await recordOutboundTransferFromInfo(db, adapter, updated, now);
        }
        return toDomainSummary(updated, false);
      } catch (err) {
        failures.push(toSyncFailure(record.name, err));
        return toDomainSummary(record, true);
      }
    }),
  );

  // §10.1「同時に Poll も消化する」。Poll が落ちても同期結果は返す
  const poll = await consumePollSafely(db);

  return {
    domains: synced.filter((summary) => summary !== null),
    failures,
    poll,
  };
}
