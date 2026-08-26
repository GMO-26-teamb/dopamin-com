import type { RegistryAdapter } from "@dopamin/registry";
import type {
  DomainInfo,
  TransferDirection,
  TransferResult,
  TransferSummary,
  TransfersListResponse,
} from "@dopamin/shared";
import {
  TRANSFER_AUTO_APPROVE_MS,
  transferAutoApproveAt,
} from "@dopamin/shared";
import { ApiException } from "../lib/errors";
import { adapterForDomain } from "../lib/registries";
import { upsertDomainFromInfo } from "./domain.service";
import { getDomainStore } from "./domain-store";
import {
  getTransferStore,
  type TransferRecord,
  type TransferStore,
} from "./transfer-store";

/**
 * 移管（FR-12）のアプリケーションサービス。
 *
 * `transfers` テーブルが移管の SSOT で、レジストリ由来の正規化結果
 * （`TransferResult` / `PollMessage`）をここで行に落とす。ルートは薄く保ち、
 * 「承認検知 → `info` 取り込み → `domains` 行作成」の順序（§6.5）はこのファイルに閉じる。
 */

/** DB の行 → API の要約（§10.1）。`null` の任意項目は省略して返す。 */
export function toTransferSummary(record: TransferRecord): TransferSummary {
  return {
    id: record.id,
    domainName: record.domainName,
    registry: record.registry,
    direction: record.direction,
    status: record.status,
    ...(record.registryStatus === null
      ? {}
      : { registryStatus: record.registryStatus }),
    ...(record.counterpartRegistrarId === null
      ? {}
      : { counterpartRegistrarId: record.counterpartRegistrarId }),
    requestedAt: record.requestedAt?.toISOString() ?? null,
    actByAt: record.actByAt?.toISOString() ?? null,
    completedAt: record.completedAt?.toISOString() ?? null,
    domainId: record.domainId,
  };
}

/**
 * 相手レジストラ ID（§9.1 `counterpart_registrar_id`）。
 * 正規化型の申請側 / 対応側のうち自レジストラでない方を採る（ADR-0002 決定 3）。
 */
export function counterpartRegistrarId(
  result: Pick<TransferResult, "requestingRegistrarId" | "actingRegistrarId">,
  selfRegistrarId: string,
): string | null {
  const ids = [result.requestingRegistrarId, result.actingRegistrarId].filter(
    (id): id is string => id !== undefined,
  );
  return ids.find((id) => id !== selfRegistrarId) ?? null;
}

/**
 * 移管の向き（§9.1 `direction`）。申請したのが自レジストラなら `in`（gaining）、
 * 対応するのが自レジストラなら `out`（losing）。どちらも一致しなければ判定不能。
 */
export function transferDirectionOf(
  result: Pick<TransferResult, "requestingRegistrarId" | "actingRegistrarId">,
  selfRegistrarId: string,
): TransferDirection | null {
  if (result.requestingRegistrarId === selfRegistrarId) {
    return "in";
  }
  if (result.actingRegistrarId === selfRegistrarId) {
    return "out";
  }
  return null;
}

/**
 * レジストリとアプリの時計のずれを吸収する猶予（承認判定の窓の後ろ側）。
 * サーバ自動承認の実行がレジストリ側で多少遅れる分もここで吸収する。
 */
const APPROVAL_WINDOW_SLACK_MS = 5 * 60 * 1000;

/**
 * `info` から移管の承認を判定する（§6.5 の完了検知の一部）。
 *
 * `transferQuery` は `info` の `pendingTransfer` から導出するため、申請が消えたことしか
 * 分からず承認 / 拒否 / 取消を区別できない（ADR-0002 決定 1）。区別の主情報源は Poll だが、
 * `lastTransferAt`（EPP の trDate）が動いていれば承認は確定できる。
 *
 * ただし trDate は「そのドメインが最後に移管された時刻」でしかなく、**それが自分の申請に
 * よるものかは分からない**（`sponsoringRegistrarId` は当面 null なので突き合わせられない。
 * ADR-0002 決定 4）。拒否・取消の行は Poll 消化（#58）が入るまで `pending` のまま残るので、
 * 「申請時刻以降」だけを条件にすると、後日まったく無関係に同じドメインが移管された時点で
 * 死んだ行が承認扱いになり、他人のドメインを取り込んでしまう。
 *
 * そこで判定の窓を **申請時刻 〜 自動承認期限（+ 時計ずれの猶予）** に閉じる。
 * 移管は放置してもこの期限までに必ず決着する（§11.3）ので、窓の外で動いた trDate は
 * 自分の申請とは無関係と判断してよい。窓の外の確定は Poll に委ねる。
 */
export function isApprovedByInfo(
  info: Pick<DomainInfo, "lastTransferAt">,
  window: { requestedAt: Date | null; actByAt: Date | null },
): boolean {
  // 申請時刻が分からない行は窓を張れないので承認と見なさない（Poll に委ねる）
  if (info.lastTransferAt === null || window.requestedAt === null) {
    return false;
  }
  const transferredAt = new Date(info.lastTransferAt).getTime();
  if (Number.isNaN(transferredAt)) {
    return false;
  }
  const from = window.requestedAt.getTime();
  const until =
    (window.actByAt?.getTime() ?? from + TRANSFER_AUTO_APPROVE_MS) +
    APPROVAL_WINDOW_SLACK_MS;
  return transferredAt >= from && transferredAt <= until;
}

/**
 * 移管 IN の申請を受理したことを永続化する（AC-12-1）。
 * `domains` 行はまだ作らない（保有一覧に出さない。§6.5）。
 *
 * 同じドメインへの pending な IN 行が既にあれば、二重に行を増やさず最新の応答で上書きする。
 */
export async function recordInboundTransferRequest(
  userId: string,
  adapter: RegistryAdapter,
  result: TransferResult,
  now: Date = new Date(),
): Promise<TransferRecord> {
  const store = getTransferStore();
  const requestedAt = result.requestedAt ? new Date(result.requestedAt) : now;
  const values = {
    userId,
    domainId: null,
    domainName: result.name,
    registry: adapter.id,
    direction: "in" as const,
    status: "pending" as const,
    registryStatus: result.registryStatus ?? null,
    counterpartRegistrarId: counterpartRegistrarId(result, adapter.registrarId),
    registryMessageId: null,
    requestedAt,
    // レジストリが acDate を返さない場合は申請 + 20 分（§9.2 transferAutoApproveAt）
    actByAt: transferAutoApproveAt(requestedAt, result.actByAt ?? null),
    completedAt: null,
    raw: result.raw,
  };

  const existing = await store.findPending(result.name, "in");
  if (existing && existing.userId === userId) {
    const updated = await store.update(existing.id, values);
    return updated ?? existing;
  }
  return store.create(values);
}

/**
 * 別ユーザーが保有中の `domains` 行があるか（NFR-04 の所有権ガード）。
 *
 * `domains` の一意制約は FQDN 単位（保有中の行のみ）なので、`upsertDomainFromInfo` は
 * 同名の保有行があれば `user_id` ごと上書きしてしまう。移管の取り込みと移管 OUT の反映は
 * レジストリの状態から他ユーザーの行に触れうる唯一の経路なので、
 * ここだけは書き込む前に所有者を確認する。
 */
async function ownedByAnotherUser(
  name: string,
  userId: string,
): Promise<boolean> {
  const existing = await getDomainStore().find(name);
  return (
    existing !== null &&
    existing.ownership === "owned" &&
    existing.userId !== userId
  );
}

/** 所有権ガードに引っかかった取り込み・遷移を構造化ログに残す（NFR-06）。 */
function warnOwnershipConflict(record: TransferRecord, action: string): void {
  console.warn(
    JSON.stringify({
      level: "warn",
      type: "transfer_ownership_conflict",
      action,
      transferId: record.id,
      userId: record.userId,
      domain: record.domainName,
      message:
        "別ユーザーが保有中のドメインだったため移管の反映を見送りました（Poll 消化で再判定します）",
    }),
  );
}

/**
 * 承認済み IN の取り込み: `info` → `domains` 行作成 → `domain_id` 紐付け（§6.5）。
 * 取り込みに失敗しても行は `approved` のまま残し、次回の照会で再試行する。
 *
 * 同名を別ユーザーが保有中なら取り込まない（`domain_id` は null のまま）。
 * このアプリ内の 2 ユーザー間ではレジストリの移管が起きないので、
 * この状況は自分の申請と無関係な移管を拾ったことを意味する。
 */
async function importApprovedInbound(
  userId: string,
  record: TransferRecord,
  info: DomainInfo,
  store: TransferStore,
  now: Date,
): Promise<TransferRecord> {
  if (await ownedByAnotherUser(info.name, userId)) {
    warnOwnershipConflict(record, "import");
    return record;
  }
  const domain = await upsertDomainFromInfo(userId, info, now);
  const updated = await store.update(record.id, {
    status: "approved",
    domainId: domain.id,
    completedAt: record.completedAt ?? now,
  });
  return updated ?? record;
}

/**
 * 1 件の移管行をレジストリと突き合わせて最新化する（§6.5）。
 *
 * - `pending`: `transferQuery` で照会。まだ移管中なら生値だけ更新する。
 *   移管中でなくなっていたら `info` の `lastTransferAt` で承認かどうかを判定し、
 *   承認なら IN は取り込み、OUT は `domains` を `transferred_out` に倒す。
 *   拒否・取消は `transferQuery` では区別できないので pending のまま Poll（#58）に委ねる。
 * - `approved` かつ IN かつ未紐付け: 前回失敗した取り込みを再試行する。
 * - それ以外（確定済みの履歴）: レジストリには問い合わせない。
 */
export async function refreshTransfer(
  userId: string,
  record: TransferRecord,
  now: Date = new Date(),
): Promise<TransferRecord> {
  const store = getTransferStore();
  const needsImportRetry =
    record.status === "approved" &&
    record.direction === "in" &&
    record.domainId === null;
  if (record.status !== "pending" && !needsImportRetry) {
    return record;
  }

  const adapter = adapterForDomain(record.domainName);

  if (needsImportRetry) {
    const info = await adapter.info(record.domainName);
    return importApprovedInbound(userId, record, info, store, now);
  }

  const queried = await adapter.transferQuery(record.domainName);
  const patch = {
    registryStatus: queried.registryStatus ?? record.registryStatus,
    counterpartRegistrarId:
      counterpartRegistrarId(queried, adapter.registrarId) ??
      record.counterpartRegistrarId,
    raw: queried.raw,
  };
  if (queried.status === "pending") {
    const updated = await store.update(record.id, patch);
    return updated ?? record;
  }

  // 移管中でなくなった。承認だけは info の trDate から確定できる
  const info = await adapter.info(record.domainName);
  const approved = isApprovedByInfo(info, {
    requestedAt: record.requestedAt,
    actByAt: record.actByAt,
  });
  // 別ユーザーの保有行に触れる遷移はしない（自分の申請と無関係な移管を拾った状態）
  const conflicted =
    approved && (await ownedByAnotherUser(record.domainName, userId));
  if (conflicted) {
    warnOwnershipConflict(record, record.direction === "in" ? "import" : "out");
  }
  if (!approved || conflicted) {
    // 拒否 / 取消のどちらかだが区別できない。pending のまま Poll 消化に委ねる
    const updated = await store.update(record.id, patch);
    return updated ?? record;
  }

  if (record.direction === "in") {
    const settled =
      (await store.update(record.id, {
        ...patch,
        status: "approved",
        completedAt: now,
      })) ?? record;
    return importApprovedInbound(userId, settled, info, store, now);
  }

  // 移管 OUT の完了。行は消さず ownership を倒して履歴に残す（AC-12-5）
  await getDomainStore().markTransferredOut(record.domainName, now);
  const updated = await store.update(record.id, {
    ...patch,
    status: "approved",
    completedAt: now,
  });
  return updated ?? record;
}

/**
 * `GET /transfers`（FR-12 / AC-12-1 / AC-12-3）。
 *
 * 進行中の行はレジストリに照会して最新化してから区画ごとに返す。
 * 1 件の照会が失敗しても一覧全体は返す（DB の内容をそのまま出す）。
 * レジストリが落ちている状況で移管履歴すら見えなくなる方が実害が大きいため。
 */
export async function listTransfers(
  userId: string,
  now: Date = new Date(),
): Promise<TransfersListResponse> {
  const records = await getTransferStore().list(userId);
  const refreshed = await Promise.all(
    records.map((record) =>
      refreshTransfer(userId, record, now).catch(() => record),
    ),
  );

  return {
    inbound: refreshed
      .filter((r) => r.direction === "in" && r.status === "pending")
      .map(toTransferSummary),
    outbound: refreshed
      .filter((r) => r.direction === "out" && r.status === "pending")
      .map(toTransferSummary),
    history: refreshed
      .filter((r) => r.status !== "pending")
      .map(toTransferSummary),
  };
}

/**
 * 移管行を 1 件引く（所有権チェック込み）。
 * 他ユーザーの行は 404 ではなく 403（§10.3 の FORBIDDEN = 所有権なし）。
 */
export async function requireOwnedTransfer(
  userId: string,
  id: string,
): Promise<TransferRecord> {
  const record = await getTransferStore().findById(id);
  if (!record) {
    throw new ApiException("NOT_FOUND", "指定された移管は見つかりません。");
  }
  if (record.userId !== userId) {
    throw new ApiException("FORBIDDEN", "この移管を参照する権限がありません。");
  }
  return record;
}

/**
 * `GET /transfers/:id`（FR-12 / AC-12-3）。
 * 承認を検知したら `info` で取り込み、`domains` 行を作って `domain_id` を紐付ける。
 */
export async function getTransfer(
  userId: string,
  id: string,
  now: Date = new Date(),
): Promise<TransferSummary> {
  const record = await requireOwnedTransfer(userId, id);
  return toTransferSummary(await refreshTransfer(userId, record, now));
}
