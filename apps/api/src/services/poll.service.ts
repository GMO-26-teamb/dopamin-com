import type { RegistryAdapter } from "@dopamin/registry";
import { RegistryError } from "@dopamin/registry";
import type {
  DomainInfo,
  DomainSyncWithPollResponse,
  PollConsumeResult,
  PollMessage,
  TransferDirection,
  TransferResult,
} from "@dopamin/shared";
import { adapterForDomain, getRegistrySet } from "../lib/registries";
import { registryErrorMessage } from "../lib/registry-message";
import { syncDomains, upsertDomainFromInfo } from "./domain.service";
import { type DomainRecord, getDomainStore } from "./domain-store";
import {
  counterpartRegistrarId,
  recordOutboundTransferRequest,
  transferDirectionOf,
} from "./transfer.service";
import { getTransferStore, type TransferRecord } from "./transfer-store";

/**
 * Poll（非同期通知）の消化（docs/requirements.md FR-12 / §6.5 / §10.1）。
 *
 * 移管の承認 / 拒否 / 取消は `transferQuery`（`info` の `pendingTransfer` からの導出）では
 * 区別できない（ADR-0002 決定 1）。区別できる唯一の情報源がこの Poll なので、
 * 移管の状態遷移はここが主経路になる。`GET /transfers` 表示時・`POST /domains/sync`・
 * `POST /registry/poll` から呼ぶ。
 *
 * `GET /messages` は最古の未 ack を 1 件返す FIFO で、ack するまで同じ通知が返り続ける。
 * 消化しないと以降の通知が読めなくなるので、未 ack が無くなるまで繰り返す。
 */

/**
 * 1 レジストリあたり 1 回の消化で処理する通知の上限。
 * `ackMessage` が黙って成功したのにキューから消えない、といった異常時に
 * サーバレス関数の実行時間を使い切らないための保険。
 */
const MAX_MESSAGES_PER_REGISTRY = 50;

function emptyResult(): PollConsumeResult {
  return { processed: 0, created: 0, settled: 0, skipped: 0, failures: [] };
}

/** 通知が伝える移管の正規化結果。payload から取れない場合は最低限を組み立てる。 */
function transferOf(message: PollMessage, name: string): TransferResult {
  return (
    message.transfer ?? {
      name,
      status: message.type === "transfer_request" ? "pending" : "none",
      raw: message.raw,
    }
  );
}

/** 通知の種別 → 確定後の `transfers.status`。`transfer_request` と未知種別は対象外。 */
const SETTLED_STATUS = {
  transfer_approved: "approved",
  transfer_rejected: "rejected",
  transfer_cancelled: "cancelled",
} as const;

type SettledType = keyof typeof SETTLED_STATUS;

function isSettledType(type: PollMessage["type"]): type is SettledType {
  return type in SETTLED_STATUS;
}

/**
 * 確定通知に対応する `transfers` 行を引く。
 *
 * 通知がレジストラ ID を持っていれば向きを導出して絞る（ADR-0002 決定 3）。
 * 持っていない場合は IN を優先して両方向を探す: 自分が出した申請の方が
 * ユーザーの操作に直結していて、取りこぼしたときの影響が大きいため。
 */
async function findRowForSettlement(
  adapter: RegistryAdapter,
  name: string,
  result: TransferResult,
): Promise<TransferRecord | null> {
  const store = getTransferStore();
  const direction: TransferDirection | null = transferDirectionOf(
    result,
    adapter.registrarId,
  );
  if (direction !== null) {
    return store.findPending(name, direction);
  }
  return (
    (await store.findPending(name, "in")) ??
    (await store.findPending(name, "out"))
  );
}

/**
 * 移管 IN の承認を検知したときの取り込み（§6.5）。
 * `info` → `domains` 行作成 → `domain_id` 紐付け。
 * 別ユーザーが保有中なら取り込まない（NFR-04。通知と手元の状態が食い違っている）。
 */
async function importApproved(
  adapter: RegistryAdapter,
  row: TransferRecord,
  now: Date,
): Promise<string | null> {
  const existing = await getDomainStore().find(row.domainName);
  if (
    existing !== null &&
    existing.ownership === "owned" &&
    existing.userId !== row.userId
  ) {
    console.warn(
      JSON.stringify({
        level: "warn",
        type: "transfer_ownership_conflict",
        action: "poll_import",
        transferId: row.id,
        userId: row.userId,
        domain: row.domainName,
        message: "別ユーザーが保有中のドメインだったため取り込みを見送りました",
      }),
    );
    return null;
  }
  const info = await adapter.info(row.domainName);
  const domain = await upsertDomainFromInfo(row.userId, info, now);
  return domain.id;
}

/** 通知 1 件の処理結果の内訳（`PollConsumeResult` に足し込む）。 */
type Outcome = "created" | "settled" | "skipped";

/**
 * 受信した移管申請（`transfer_request`）を `transfers(out, pending)` にする（AC-12-4）。
 * 保有していないドメインの通知は対応づけられないので ack だけする。
 */
async function handleRequest(
  adapter: RegistryAdapter,
  message: PollMessage,
  name: string,
  now: Date,
): Promise<Outcome> {
  const domain = await getDomainStore().find(name);
  if (domain === null || domain.ownership !== "owned") {
    return "skipped";
  }
  // 通知はキューに溜まるので、承認 / 拒否で決着した後に申請の通知を読むことがある
  // （承認 / 拒否を先に別経路で処理した場合や、消化が滞った場合）。
  // レジストリにまだ申請が残っていることを確かめてから行を作る。
  // これを見ないと、確定済みの移管が古い通知で pending として復活する。
  const queried = await adapter.transferQuery(name);
  if (queried.status !== "pending") {
    return "skipped";
  }
  await recordOutboundTransferRequest(
    domain.userId,
    adapter,
    message.transfer ?? queried,
    { domainId: domain.id, registryMessageId: message.id },
    now,
  );
  return "created";
}

/**
 * 確定通知（承認 / 拒否 / 取消）を `transfers` と `domains` に反映する。
 *
 * 対応する pending 行が無い承認通知でも、そのドメインを保有していれば移管 OUT の
 * 完了として扱う（§6.5「Poll の移管承認通知を検知したら transferred_out に遷移させる」）。
 * 申請の受信通知を取りこぼしていても所有権だけは正しくなるようにするため。
 */
async function handleSettlement(
  adapter: RegistryAdapter,
  message: PollMessage,
  name: string,
  type: SettledType,
  now: Date,
): Promise<Outcome> {
  const store = getTransferStore();
  const result = transferOf(message, name);
  const status = SETTLED_STATUS[type];
  const row = await findRowForSettlement(adapter, name, result);

  if (row === null) {
    if (status !== "approved") {
      // 拒否・取消は手元に行が無ければ記録すべき事実が残らない
      return "skipped";
    }
    const domain = await getDomainStore().find(name);
    if (domain === null || domain.ownership !== "owned") {
      return "skipped";
    }
    // pending 行が無い承認通知は 2 通りに読める:
    //   (a) 移管 IN の確定が `GET /transfers` の照合（`info` の trDate）で先に済んでいた
    //   (b) 申請の受信通知を取りこぼしたまま承認だけ届いた移管 OUT
    // レジストラ ID を返さないレジストリでは向きから区別できないので、直近に承認済みの
    // IN 行があれば (a) と読む。(b) と誤ると、取り込んだばかりの保有行を
    // transferred_out に倒してユーザーのドメインを一覧から消してしまうため。
    const direction = transferDirectionOf(result, adapter.registrarId);
    const settledInbound =
      direction === "in" ||
      (await store.findLatest(name, "in", "approved")) !== null;
    if (settledInbound) {
      return "skipped";
    }
    // (b) 移管 OUT の完了。履歴を残しつつ所有権を倒す
    const created = await recordOutboundTransferRequest(
      domain.userId,
      adapter,
      result,
      { domainId: domain.id, registryMessageId: message.id },
      now,
    );
    await getDomainStore().markTransferredOut(name, now);
    await store.update(created.id, { status: "approved", completedAt: now });
    return "settled";
  }

  const patch = {
    status,
    completedAt: now,
    registryStatus: result.registryStatus ?? row.registryStatus,
    counterpartRegistrarId:
      counterpartRegistrarId(result, adapter.registrarId) ??
      row.counterpartRegistrarId,
    raw: message.raw,
  };

  if (status !== "approved") {
    await store.update(row.id, patch);
    return "settled";
  }

  if (row.direction === "in") {
    // 移管 IN の完了。取り込みに失敗しても approved のまま残し、
    // 次回の `GET /transfers` で再試行する（§6.5）
    await store.update(row.id, patch);
    const domainId = await importApproved(adapter, row, now);
    if (domainId !== null) {
      await store.update(row.id, { domainId });
    }
    return "settled";
  }

  // 移管 OUT の完了。行は消さず ownership を倒して履歴に残す（AC-12-5）
  await getDomainStore().markTransferredOut(name, now);
  await store.update(row.id, patch);
  return "settled";
}

/** 通知 1 件を処理する。ack は呼び出し側の責務。 */
async function handleMessage(
  adapter: RegistryAdapter,
  message: PollMessage,
  now: Date,
): Promise<Outcome> {
  // 対象ドメインが読めない通知は対応づけようがない。
  // 生の応答はアダプタが operation_logs（FR-15）に残しているので、ここでは ack だけする
  const name = message.domainName;
  if (name === undefined || message.type === "unknown") {
    return "skipped";
  }
  if (message.type === "transfer_request") {
    return handleRequest(adapter, message, name, now);
  }
  if (isSettledType(message.type)) {
    return handleSettlement(adapter, message, name, message.type, now);
  }
  return "skipped";
}

/** 1 レジストリのキューを空になるまで消化する。 */
async function consumeRegistry(
  adapter: RegistryAdapter,
  result: PollConsumeResult,
  now: Date,
): Promise<void> {
  for (let i = 0; i < MAX_MESSAGES_PER_REGISTRY; i += 1) {
    const message = await adapter.poll();
    if (message === null) {
      return;
    }
    // 反映に失敗した通知は ack しない。ack すると通知が失われ、移管の状態が
    // 二度と復元できなくなる。FIFO なのでキューはこの 1 件で止まるが、
    // 「静かに取りこぼす」より「次の消化で再試行する」方を選ぶ（失敗は応答に載る）。
    const outcome = await handleMessage(adapter, message, now);
    await adapter.ackMessage(message.id);
    result.processed += 1;
    result[outcome] += 1;
  }
  console.warn(
    JSON.stringify({
      level: "warn",
      type: "poll_queue_not_drained",
      registry: adapter.id,
      limit: MAX_MESSAGES_PER_REGISTRY,
      message:
        "1 回の消化で上限まで処理しました。未 ack の通知が残っている可能性があります",
    }),
  );
}

/**
 * `POST /domains/sync` の移管検知（§6.5 / AC-02-4）。`info` が取れた行ごとに呼ぶ。
 *
 * 1. `sponsoringRegistrarId` が自レジストラと違えば移管 OUT 完了として `transferred_out` に倒す。
 *    両レジストリの `info` に clID が無いため当面この値は常に null で、この分岐は効かない
 *    （検知の主経路は Poll。【要確認 §21.2 #12】が解決したら実測値で効き始める）。
 * 2. `pendingTransfer` が立っていれば受信中の移管申請として `transfers(out, pending)` を作る。
 *    保有行がある = 自レジストラがスポンサー なので、この pendingTransfer は必ず OUT 側。
 *
 * 付随処理なので失敗しても同期本体は止めない（呼び出し側が握りつぶす）。
 */
async function detectTransferOnSync(
  record: DomainRecord,
  info: DomainInfo,
  now: Date,
): Promise<void> {
  const adapter = adapterForDomain(record.name);

  if (
    info.sponsoringRegistrarId !== null &&
    info.sponsoringRegistrarId !== adapter.registrarId
  ) {
    await getDomainStore().markTransferredOut(record.name, now);
    return;
  }

  if (!info.statuses.includes("pendingTransfer")) {
    return;
  }
  const queried = await adapter.transferQuery(record.name);
  if (queried.status !== "pending") {
    return;
  }
  await recordOutboundTransferRequest(
    record.userId,
    adapter,
    queried,
    { domainId: record.id },
    now,
  );
}

/**
 * FR-02 / FR-12 / AC-02-4: Poll を消化してから保有ドメインを `info` で再同期する。
 *
 * 順序は Poll → 同期。移管の完了を確定できるのは Poll だけ（ADR-0002 決定 1）なので、
 * 先に消化しておかないと、同じリクエストで移管 OUT 済みになった行が
 * この応答の保有一覧にまだ載ってしまう（AC-02-4「最新化で一覧から消える」を満たせない）。
 * 逆向き（同期で見つけた `pendingTransfer` を同じ Poll で確定させる）は次回に回る。
 * 申請の受信は `/transfers` に出ればよく、即座の確定は要求されていないため。
 */
export async function syncDomainsAndConsumePoll(
  userId: string,
  now: Date = new Date(),
): Promise<DomainSyncWithPollResponse> {
  const pollProcessed = await consumePoll(now);
  const synced = await syncDomains(userId, {
    onSynced: (record, info) =>
      detectTransferOnSync(record, info, now).catch((err: unknown) => {
        console.warn(
          JSON.stringify({
            level: "warn",
            type: "transfer_detection_failed",
            domain: record.name,
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      }),
  });
  return { ...synced, pollProcessed };
}

/**
 * 全レジストリの Poll を消化して `transfers` / `domains` に反映する（FR-12）。
 *
 * 1 つのレジストリが落ちていても他方は消化する（部分失敗の許容）。
 * 通知はユーザーに依らずレジストラ単位で届くので、対象ユーザーは
 * ドメインの保有行（`transfer_request`）または `transfers` 行から引く。
 */
export async function consumePoll(
  now: Date = new Date(),
): Promise<PollConsumeResult> {
  const result = emptyResult();
  await Promise.all(
    getRegistrySet()
      .all()
      .map(async (adapter) => {
        try {
          await consumeRegistry(adapter, result, now);
        } catch (err) {
          result.failures.push({
            registry: adapter.id,
            message:
              err instanceof RegistryError
                ? registryErrorMessage(err)
                : "通知の取得に失敗しました。",
          });
        }
      }),
  );
  return result;
}
