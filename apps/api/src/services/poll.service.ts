import type { Db } from "@dopamin/db";
import { type RegistryAdapter, RegistryError } from "@dopamin/registry";
import type {
  PollConsumeSummary,
  PollMessage,
  TransferDirection,
  TransferRecordStatus,
} from "@dopamin/shared";
import { ApiException } from "../lib/errors";
import { getRequestContext } from "../lib/operation-log-context";
import { getRegistrySet } from "../lib/registries";
import { markDomainTransferredOut } from "./domain.service";
import { getDomainStore } from "./domain-store";
import {
  closeTransferRow,
  completeInboundTransfer,
  findLatestTransferByDomain,
  findPendingTransferByDomain,
  findTransferByMessageId,
  recordOutboundTransferRequest,
  transferDirectionOf,
} from "./transfer.service";
import type { TransferRow } from "./transfer-row";

/**
 * 非同期通知（Poll）の消化（FR-12 / docs/requirements.md §6.5 / §10.1 / ADR-0002 決定 1）。
 *
 * レジストリの `GET /messages` は **最古の未 ack を 1 件返す FIFO** で、ack するまで
 * 同じ通知が返り続ける。消化しないと以降の通知が読めなくなるので、`poll` → DB 反映 →
 * `ackMessage` を「未 ack が無くなるまで」繰り返す。
 *
 * 移管の承認 / 拒否 / 取消は `transferQuery`（`info` の `pendingTransfer` からの導出）では
 * 区別できないため、状態遷移の主情報源はこの Poll になる。
 *
 * 通知はレジストラ単位（ユーザー単位ではない）で届くので、対象ユーザーは通知の
 * ドメイン名から `domains` / `transfers` を引いて決める。どのユーザーにも紐付かない通知は
 * **ack して先へ進む**（キューを止める方が実害が大きい）。生の通知内容は
 * アダプタが `operation_logs`（`command = poll`）に残しているので調査はそこから辿れる（FR-15）。
 */

/**
 * 1 リクエストで消化する通知の上限（レジストリごと）。
 * Vercel の関数タイムアウトを溜まった通知の量で踏まないよう頭打ちにする。
 * 残りは次回の消化（`GET /transfers` / `POST /domains/sync` / `POST /registry/poll`）で片付く。
 */
const POLL_BUDGET = 50;

/** 通知の種別 → 確定後の `transfers.status`（§9.1）。 */
const STATUS_BY_TYPE = {
  transfer_approved: "approved",
  transfer_rejected: "rejected",
  transfer_cancelled: "cancelled",
} as const satisfies Record<string, TransferRecordStatus>;

/** 構造化した警告ログ（NFR-06。transfer.service.ts と同じ体裁）。 */
function warn(type: string, fields: Record<string, unknown>): void {
  console.warn(
    JSON.stringify({
      level: "warn",
      type,
      requestId: getRequestContext().requestId,
      ...fields,
    }),
  );
}

function errorCodeOf(err: unknown): string {
  return err instanceof RegistryError || err instanceof ApiException
    ? err.code
    : "INTERNAL";
}

function errorMessageOf(err: unknown): string | null {
  return err instanceof Error ? err.message.slice(0, 300) : null;
}

/**
 * 通知が表す移管の direction。レジストラ ID を返さないレジストリでは null になり、
 * その場合は「そのドメインに残っている pending 行」から向きを決める（下記 {@link applyApproved}）。
 */
function directionOfMessage(
  message: PollMessage,
  adapter: RegistryAdapter,
): TransferDirection | null {
  return message.transfer
    ? transferDirectionOf(message.transfer, adapter.registrarId)
    : null;
}

/** 通知の対象ドメイン。payload から取れない通知は紐付け先を決められない。 */
function domainNameOf(message: PollMessage): string | null {
  return message.domainName ?? message.transfer?.name ?? null;
}

/**
 * 受信した移管申請（相手レジストラが gaining）を `transfers(out, pending)` にする（AC-12-4）。
 * 保有していないドメインの通知は紐付け先が無いので ack だけして先へ進む。
 */
async function ensureOutboundRow(
  db: Db,
  adapter: RegistryAdapter,
  message: PollMessage,
  domainName: string,
  now: Date,
): Promise<TransferRow | null> {
  const record = await getDomainStore().find(domainName);
  if (record?.ownership !== "owned") {
    return null;
  }
  return recordOutboundTransferRequest(db, {
    userId: record.userId,
    domainId: record.id ?? null,
    name: domainName,
    registry: adapter.id,
    selfRegistrarId: adapter.registrarId,
    result: message.transfer ?? null,
    // 冪等キーにするのは申請の通知だけ。完了の通知は closeTransferRow が刻む
    registryMessageId: message.type === "transfer_request" ? message.id : null,
    fallbackRequestedAt: new Date(message.queuedAt),
    now,
  });
}

/**
 * 移管の成立（承認・サーバ自動承認）を反映する。
 *
 * - 移管 IN: `status = approved` にしてから `info` を `domains` に取り込む（§6.5 / AC-12-3）
 * - 移管 OUT: `status = approved` にして `domains` を `transferred_out` に倒す（AC-12-5）
 */
async function applyApproved(
  db: Db,
  adapter: RegistryAdapter,
  message: PollMessage,
  domainName: string,
  now: Date,
): Promise<void> {
  const direction = directionOfMessage(message, adapter);
  const row = await findPendingTransferByDomain(
    db,
    domainName,
    direction ?? undefined,
  );
  if (row?.direction === "in") {
    await completeInboundTransfer(
      db,
      row,
      message.transfer ?? null,
      message.id,
      now,
    );
    return;
  }
  if (row) {
    await closeTransferRow(
      db,
      row,
      "approved",
      message.transfer ?? null,
      message.id,
      now,
    );
    await markDomainTransferredOut(domainName, now);
    return;
  }
  // pending 行が無い承認通知は 2 通りに読める:
  //   (a) 移管 IN の確定が `GET /transfers` の照合（`info` の trDate）で先に済んでいた
  //   (b) 申請の通知を取りこぼしたまま完了だけ届いた移管 OUT
  // レジストラ ID を返さないレジストリでは向きから区別できないので、直近に承認済みの
  // IN 行があれば (a) と読む。(b) と誤ると、取り込んだばかりの保有行を
  // transferred_out に倒してユーザーのドメインを一覧から消してしまうため。
  const settledInbound =
    direction === "in" ||
    (await findLatestTransferByDomain(db, domainName, {
      direction: "in",
      status: "approved",
    })) !== null;
  if (settledInbound) {
    warn("poll_message_already_settled", {
      registry: adapter.id,
      messageId: message.id,
      domain: domainName,
    });
    return;
  }
  // (b) 移管 OUT の完了。行を起こしてから閉じる
  const created = await ensureOutboundRow(
    db,
    adapter,
    message,
    domainName,
    now,
  );
  if (!created) {
    warn("poll_message_unattributed", {
      registry: adapter.id,
      messageId: message.id,
      domain: domainName,
      messageType: message.type,
    });
    return;
  }
  await closeTransferRow(
    db,
    created,
    "approved",
    message.transfer ?? null,
    message.id,
    now,
  );
  await markDomainTransferredOut(domainName, now);
}

/**
 * 拒否・取消を反映する。どちらも申請が消えるだけで保有は動かないので、
 * `transfers` を閉じるだけで `domains` は触らない。
 */
async function applyClosed(
  db: Db,
  adapter: RegistryAdapter,
  message: PollMessage,
  domainName: string,
  status: TransferRecordStatus,
  now: Date,
): Promise<void> {
  const direction = directionOfMessage(message, adapter);
  const row = await findPendingTransferByDomain(
    db,
    domainName,
    direction ?? undefined,
  );
  if (!row) {
    warn("poll_message_unattributed", {
      registry: adapter.id,
      messageId: message.id,
      domain: domainName,
      messageType: message.type,
    });
    return;
  }
  await closeTransferRow(
    db,
    row,
    status,
    message.transfer ?? null,
    message.id,
    now,
  );
}

/**
 * 通知 1 件を DB に反映する。ここで例外を投げると呼び出し側は **ack しない**
 * （反映できていない通知を消すと移管の事実が永久に失われるため）。
 */
async function applyPollMessage(
  db: Db,
  adapter: RegistryAdapter,
  message: PollMessage,
): Promise<void> {
  if (message.type === "unknown") {
    // 対応づけられない通知（`msgType` は未確定【要確認: §21.2 #13】）。
    // 捨てずに ack する: 残すと FIFO で以降の通知が読めなくなる。中身は operation_logs にある
    warn("poll_message_unknown", {
      registry: adapter.id,
      messageId: message.id,
    });
    return;
  }
  const domainName = domainNameOf(message);
  if (domainName === null) {
    warn("poll_message_without_domain", {
      registry: adapter.id,
      messageId: message.id,
      messageType: message.type,
    });
    return;
  }
  // 同じ通知の二度目（ack に失敗した後の再消化）は何もしない（§9.1 の冪等キー）
  if (await findTransferByMessageId(db, adapter.id, message.id)) {
    return;
  }

  const now = new Date();
  if (message.type === "transfer_request") {
    if (
      (await ensureOutboundRow(db, adapter, message, domainName, now)) === null
    ) {
      warn("poll_message_unattributed", {
        registry: adapter.id,
        messageId: message.id,
        domain: domainName,
        messageType: message.type,
      });
    }
    return;
  }
  if (message.type === "transfer_approved") {
    await applyApproved(db, adapter, message, domainName, now);
    return;
  }
  await applyClosed(
    db,
    adapter,
    message,
    domainName,
    STATUS_BY_TYPE[message.type],
    now,
  );
}

/** 1 レジストリのキューを未 ack が無くなるまで消化する。 */
async function consumeQueue(
  db: Db,
  adapter: RegistryAdapter,
): Promise<PollConsumeSummary> {
  for (let processed = 0; processed < POLL_BUDGET; processed += 1) {
    let message: PollMessage | null;
    try {
      message = await adapter.poll();
    } catch (err) {
      warn("poll_failed", {
        registry: adapter.id,
        code: errorCodeOf(err),
        message: errorMessageOf(err),
      });
      return { processed, failed: 1 };
    }
    if (message === null) {
      return { processed, failed: 0 };
    }
    try {
      await applyPollMessage(db, adapter, message);
      await adapter.ackMessage(message.id);
    } catch (err) {
      // 反映か ack に失敗した。FIFO なのでこのレジストリのキューはここで止まるが、
      // 次回の消化で同じ通知から再開できる（反映は冪等）
      warn("poll_apply_failed", {
        registry: adapter.id,
        messageId: message.id,
        messageType: message.type,
        domain: domainNameOf(message),
        code: errorCodeOf(err),
        message: errorMessageOf(err),
      });
      return { processed, failed: 1 };
    }
  }
  // 溜まりすぎ。残りは次回の消化で片付ける（1 リクエストで全部やらない）
  warn("poll_budget_exhausted", { registry: adapter.id, budget: POLL_BUDGET });
  return { processed: POLL_BUDGET, failed: 0 };
}

/**
 * 全レジストリの Poll を消化する（§10.1）。
 * レジストリ単位では FIFO なので直列、レジストリ間は並列。
 * 1 つのレジストリが落ちても他のレジストリの消化は続ける（部分失敗）。
 */
export async function consumePoll(db: Db): Promise<PollConsumeSummary> {
  const results = await Promise.all(
    getRegistrySet()
      .all()
      .map((adapter) => consumeQueue(db, adapter)),
  );
  return results.reduce<PollConsumeSummary>(
    (total, one) => ({
      processed: total.processed + one.processed,
      failed: total.failed + one.failed,
    }),
    { processed: 0, failed: 0 },
  );
}

/**
 * 消化を「ついで」に行う経路（`GET /transfers` / `POST /domains/sync`）向け。
 * Poll が落ちても本体のレスポンスは返す（AC-03-2 と同じ部分失敗の方針）。
 */
export async function consumePollSafely(db: Db): Promise<PollConsumeSummary> {
  try {
    return await consumePoll(db);
  } catch (err) {
    warn("poll_consume_failed", {
      code: errorCodeOf(err),
      message: errorMessageOf(err),
    });
    return { processed: 0, failed: 1 };
  }
}
