import { type Db, schema } from "@dopamin/db";
import { RegistryError } from "@dopamin/registry";
import {
  type DomainInfo,
  type RegistryId,
  type TransferResult,
  type TransfersListResponse,
  transferAutoApproveAt,
  transferBucket,
} from "@dopamin/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import { ApiException } from "../lib/errors";
import { getRequestContext } from "../lib/operation-log-context";
import { adapterForDomain } from "../lib/registries";
import { claimDomainFromInfo } from "./domain.service";
import { getDomainStore } from "./domain-store";
import {
  nextStoredRaw,
  readStoredRaw,
  type StoredTransferRaw,
  type TransferRow,
  toTransferSummary,
} from "./transfer-row";

/**
 * 移管の永続化と状態照合（FR-12 / docs/requirements.md §6.5 / §9.1 / §10.1）。
 *
 * DB クライアントは第 1 引数で受け取る（services/auth.ts と同じ流儀）。
 * `domains` 側の読み書きは `domain.service.ts` 越しに行い、このファイルからは
 * `domains` テーブルを直接触らない。
 *
 * 【未実装・意図的な制約】
 * - **Poll の消化（#58）はここでは行わない。** §10.1 は `GET /transfers` で Poll も消化すると
 *   定めているが、アダプタに `poll` / `ackMessage` が入るのは #44 で、生産者がまだ居ない。
 *   そのため `direction = "out"` の行は本ファイルでは 1 件も作られず、照合対象にもしない。
 * - **拒否・取消（rejected / cancelled）は検知できない。** `transferQuery` は
 *   `info` の `pendingTransfer` からの導出で pending / none しか返せず、
 *   「承認されて消えた」と「拒否・取消で消えた」を区別できない（ADR-0002 / registry-api.md §3.3）。
 *   承認と断定できない `none` は pending のまま据え置き、判別は Poll（#58）に委ねる。
 * - `newExpiresAt` は当面つねに undefined なので `transfers` には持たない（ADR-0002）。
 */

/**
 * 1 リクエストで照合するレジストリ呼び出しの上限。
 * `GET /transfers` は pending 行の件数だけレジストリを叩くため、Vercel の関数タイムアウトを
 * 1 ユーザーの行数で踏まないよう頭打ちにする。超過分は DB の値のまま返し、警告を残す。
 */
const RECONCILE_LIMIT = 20;

/**
 * 取り込み再試行でレジストリを叩き直す上限（完了検知からの経過時間）。
 *
 * `transfers.domain_id` は ON DELETE SET NULL なので、取り込み済みのドメインを廃止したり
 * FR-16 のデモリセットを流したりすると `approved` かつ `domain_id = null` の行に戻る。
 * 期限を切らないと、その行が一覧を開くたびに永久に `info` を叩き続ける。
 * ユーザーが明示的に叩く `GET /transfers/:id` はこの制限を掛けない（S-50 の再試行導線）。
 */
const IMPORT_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * 承認とみなす `trDate` の上限に足す猶予（{@link isApprovedByInfo}）。
 * 正規の承認は遅くともサーバの自動承認（申請 + 20 分。FR-12）で起きるが、
 * レジストリ側の時計ずれ・自動承認の遅延を吸収するために広めに取る。
 */
const APPROVAL_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * 相手レジストラ ID（§9.1 `counterpart_registrar_id`）。
 * 正規化型の `requestingRegistrarId` / `actingRegistrarId` のうち自レジストラでない側を採る
 * （レジストリの語彙は申請時点の役割語で direction と一対一にならない。ADR-0002 決定 3）。
 * 実アダプタの `transferQuery` はどちらも返さないため実レジストリでは当面 null になる。
 */
export function counterpartRegistrarId(
  result: Pick<TransferResult, "requestingRegistrarId" | "actingRegistrarId">,
  selfRegistrarId: string,
): string | null {
  const ids = [result.requestingRegistrarId, result.actingRegistrarId];
  return ids.find((id) => id !== undefined && id !== selfRegistrarId) ?? null;
}

/** 構造化した警告ログ（NFR-06。routes/domains.ts のキャッシュ退避ログと同じ体裁）。 */
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

/** 行の申請日時。§9.1 では nullable だが本アプリの行は必ず埋める（保険で created_at）。 */
function requestedAtOf(row: TransferRow): Date {
  return row.requestedAt ?? row.createdAt;
}

export interface InboundTransferRequestInput {
  userId: string;
  /** 申請対象の FQDN（小文字）。 */
  name: string;
  registry: RegistryId;
  /** 自レジストラ ID（`adapter.registrarId`）。相手レジストラの導出に使う。 */
  selfRegistrarId: string;
  /**
   * `transferRequest`（またはタイムアウト照合）の結果。
   * `null` は「タイムアウトして受理を確認できなかった」で、行だけ作って次回の照合に託す。
   */
  result: TransferResult | null;
  /**
   * レジストリへ申請を **送り始めた** 時刻。レジストリが `reDate` を返さない場合の
   * `requested_at` の代わりになる。応答を待った時間（タイムアウトなら 15 秒）だけ
   * 後ろにずれた「今」を使うと、待っている間に成立した移管の `trDate` が
   * `requested_at` より前になり、承認を永久に検知できなくなる（{@link isApprovedByInfo}）。
   */
  startedAt: Date;
  now?: Date;
}

/**
 * FR-12 移管 IN の申請を `transfers` に記録する（AC-12-1）。
 * `domains` 行はここでは作らない。承認を検知してから作る（§6.5）。
 *
 * 同じユーザー・同じドメインの進行中（`pending`）の IN 行があれば作り直さず更新する。
 * レジストリも `pendingTransfer` 中の再申請を 2304 で弾くので通常は 1 行に収まるが、
 * タイムアウト照合（AC-18-2）の経路では同じ申請が二度届きうる。
 *
 * 更新は touchPending と同じ「判明した値だけ書く」方針にする。実アダプタの `transferQuery`
 * は `{ name, status, raw }` しか返さない（kitaq.ts）ので、INSERT 用の値をそのまま当てると
 * 最初の `transferRequest` で分かっていた相手レジストラ ID などを null で潰し、
 * `requested_at` / `act_by_at` を再申請のたびに後ろへ動かしてしまう。
 */
export async function recordInboundTransferRequest(
  db: Db,
  input: InboundTransferRequestInput,
): Promise<TransferRow | null> {
  const now = input.now ?? new Date();
  const { result } = input;
  const requestedAt = result?.requestedAt
    ? new Date(result.requestedAt)
    : input.startedAt;
  const registryStatus = result?.registryStatus ?? null;
  const counterpart = result
    ? counterpartRegistrarId(result, input.selfRegistrarId)
    : null;
  const rawPatch: StoredTransferRaw = result
    ? {
        registry: result.raw,
        checkedAt: now.toISOString(),
        reconcile: undefined,
      }
    : { reconcile: "timeout_unconfirmed", checkedAt: now.toISOString() };

  const [existing] = await db
    .select()
    .from(schema.transfers)
    .where(
      and(
        eq(schema.transfers.userId, input.userId),
        eq(schema.transfers.domainName, input.name),
        eq(schema.transfers.direction, "in"),
        eq(schema.transfers.status, "pending"),
      ),
    )
    .limit(1);

  if (existing) {
    // 申請日時と自動承認期限は最初の申請のものが正。再申請で動かすと
    // 画面のカウントダウンが実際の期限とずれ、承認検知の基準もずれる。
    const [updated] = await db
      .update(schema.transfers)
      .set({
        registryStatus: registryStatus ?? existing.registryStatus,
        counterpartRegistrarId: counterpart ?? existing.counterpartRegistrarId,
        raw: nextStoredRaw(existing.raw, rawPatch),
      })
      .where(eq(schema.transfers.id, existing.id))
      .returning();
    return updated ?? existing;
  }

  const [row] = await db
    .insert(schema.transfers)
    .values({
      userId: input.userId,
      domainName: input.name,
      registry: input.registry,
      direction: "in",
      status: "pending",
      registryStatus,
      counterpartRegistrarId: counterpart,
      requestedAt,
      // 自動承認の期限はレジストリの acDate 優先、無ければ申請 + 20 分（§9.2 / FR-12）
      actByAt: transferAutoApproveAt(requestedAt, result?.actByAt ?? null),
      raw: rawPatch,
    })
    .returning();
  return row ?? null;
}

/** ユーザーの移管を新しい順に返す（§10.1 `GET /transfers`）。 */
export async function listUserTransferRows(
  db: Db,
  userId: string,
): Promise<TransferRow[]> {
  return db
    .select()
    .from(schema.transfers)
    .where(eq(schema.transfers.userId, userId))
    .orderBy(
      // 申請日時が無い行（Poll 由来・#58）を末尾に落とす
      sql`${schema.transfers.requestedAt} DESC NULLS LAST`,
      desc(schema.transfers.createdAt),
    );
}

/**
 * 1 件引く（§10.1 `GET /transfers/:id`）。
 * 行が無ければ 404、他ユーザーの行は 403（`requireOwnedDomain` と同じ返し分け。§10.3）。
 * 所有権は `transfers.user_id` で見る。移管 IN は申請時点で `domains` 行が無いため、
 * ここで `requireOwnedDomain` を使うと AC-12-1 の申請直後がすべて 404 になる。
 */
export async function requireOwnedTransfer(
  db: Db,
  userId: string,
  id: string,
): Promise<TransferRow> {
  const [row] = await db
    .select()
    .from(schema.transfers)
    .where(eq(schema.transfers.id, id))
    .limit(1);
  if (!row) {
    throw new ApiException("NOT_FOUND", "移管が見つかりません。");
  }
  if (row.userId !== userId) {
    throw new ApiException("FORBIDDEN", "この移管を参照する権限がありません。");
  }
  return row;
}

/** 行を §10.1 の 3 バケットに割り振る（並びは listUserTransferRows のまま）。 */
export function toTransfersListResponse(
  rows: TransferRow[],
): TransfersListResponse {
  const response: TransfersListResponse = {
    inbound: [],
    outbound: [],
    history: [],
  };
  for (const row of rows) {
    const summary = toTransferSummary(row);
    response[transferBucket(summary)].push(summary);
  }
  return response;
}

/** 照合が必要な行か（進行中の IN、または取り込み待ちの IN）。 */
function needsReconcile(row: TransferRow): boolean {
  if (row.direction !== "in") {
    return false;
  }
  return (
    row.status === "pending" ||
    (row.status === "approved" && row.domainId === null)
  );
}

/**
 * 承認済みの移管 IN を `domains` に取り込み、`domain_id` を紐付ける（§6.5 / AC-12-3）。
 *
 * 取り込みに失敗しても `status` は `approved` のまま残す。呼び出し側が例外を握りつぶし、
 * 次回の一覧表示 / 単票取得で再試行する。
 */
async function importApprovedTransfer(
  db: Db,
  row: TransferRow,
  info: DomainInfo,
  syncedAt?: Date,
): Promise<TransferRow> {
  const domainId = await claimDomainFromInfo(row.userId, info, syncedAt);
  if (domainId === null) {
    // 同名の保有行が他ユーザーのものだった。承認の検知は info からの推定なので、
    // 推定を根拠に他人の保有行を奪わない（§6.5 の transferred_out 遷移は Poll 起点・#58）。
    warn("transfer_import_conflict", {
      transferId: row.id,
      domain: row.domainName,
      registry: row.registry,
    });
    return row;
  }
  const [updated] = await db
    .update(schema.transfers)
    .set({ domainId })
    .where(eq(schema.transfers.id, row.id))
    .returning();
  return updated ?? row;
}

/**
 * 承認を検知したので `status = approved` を先に確定させる（§6.5 の順序）。
 * 取り込みが失敗しても行はこの状態で残り、次回再試行される。
 */
async function markApproved(
  db: Db,
  row: TransferRow,
  info: DomainInfo,
  queried: TransferResult,
  now: Date,
): Promise<TransferRow> {
  const [updated] = await db
    .update(schema.transfers)
    .set({
      status: "approved",
      // レジストリが返した移管完了時刻を優先する（アプリの時計に依存させない）
      completedAt: info.lastTransferAt ? new Date(info.lastTransferAt) : now,
      registryStatus: queried.registryStatus ?? row.registryStatus,
      raw: nextStoredRaw(row.raw, {
        registry: queried.raw,
        checkedAt: now.toISOString(),
        reconcile: undefined,
      }),
    })
    .where(eq(schema.transfers.id, row.id))
    .returning();
  return updated ?? row;
}

/** 完了（承認以外）を検知した行を閉じる。実アダプタはこの経路に入らない（ADR-0002）。 */
async function markClosed(
  db: Db,
  row: TransferRow,
  status: "rejected" | "cancelled",
  queried: TransferResult,
  now: Date,
): Promise<TransferRow> {
  const [updated] = await db
    .update(schema.transfers)
    .set({
      status,
      completedAt: now,
      registryStatus: queried.registryStatus ?? row.registryStatus,
      raw: nextStoredRaw(row.raw, {
        registry: queried.raw,
        checkedAt: now.toISOString(),
        reconcile: undefined,
      }),
    })
    .where(eq(schema.transfers.id, row.id))
    .returning();
  return updated ?? row;
}

/** pending のまま据え置く行の照合結果を書き戻す（判明した値だけ上書きする）。 */
async function touchPending(
  db: Db,
  row: TransferRow,
  queried: TransferResult,
  selfRegistrarId: string,
  now: Date,
): Promise<TransferRow> {
  const [updated] = await db
    .update(schema.transfers)
    .set({
      // 実アダプタは registryStatus も相手レジストラ ID も返さない。
      // null で上書きすると申請時に分かっていた値まで消えるため、非 null のときだけ書く。
      registryStatus: queried.registryStatus ?? row.registryStatus,
      counterpartRegistrarId:
        counterpartRegistrarId(queried, selfRegistrarId) ??
        row.counterpartRegistrarId,
      raw: nextStoredRaw(row.raw, {
        registry: queried.raw,
        checkedAt: now.toISOString(),
        // 受理が確認できたので「未確認のタイムアウト」の印は外す
        reconcile: undefined,
      }),
    })
    .where(eq(schema.transfers.id, row.id))
    .returning();
  return updated ?? row;
}

/**
 * 承認済みかを `info` から判定する。
 *
 * `transferQuery` は `pendingTransfer` の有無しか見ないため、申請が消えた理由
 * （承認 / 拒否 / 取消）を返せない。移管が成立した場合だけレジストリが `trDate`
 * （= `info.lastTransferAt`）を申請日時より後に更新するので、それを承認の証跡に使う。
 *
 * 上限（`act_by_at` + {@link APPROVAL_GRACE_MS}）を付けるのは、**この申請とは無関係な
 * 後日の移管を自分の承認と取り違えないため**。拒否・取消は検知できず行が pending のまま
 * 残る（下記の制約）ので、上限が無いと「拒否された数日後に第三者へ移管された」だけで
 * `trDate` が進み、他人のドメインを保有一覧に取り込んでしまう。
 * 正規の承認は相手の approve かサーバの自動承認（申請 + 20 分。FR-12）で起きるので、
 * 期限を大きく過ぎた `trDate` は自分の申請の結果ではない。
 *
 * 判定できない場合（`trDate` を返さないレジストリ・拒否・取消・期限超過）は false を返し、
 * 行を pending のまま残す。確定は Poll（#58）に委ねる。
 */
function isApprovedByInfo(row: TransferRow, info: DomainInfo): boolean {
  if (info.statuses.includes("pendingTransfer") || !info.lastTransferAt) {
    return false;
  }
  const transferredAt = new Date(info.lastTransferAt).getTime();
  const deadline =
    (row.actByAt ?? transferAutoApproveAt(requestedAtOf(row))).getTime() +
    APPROVAL_GRACE_MS;
  return (
    transferredAt >= requestedAtOf(row).getTime() && transferredAt <= deadline
  );
}

/**
 * 取り込み待ち（`approved` かつ `domain_id` が null）の行を再試行する（§6.5）。
 *
 * 再試行期限は「承認を検知した時刻」（`raw.checkedAt`）から測る。`completed_at` は
 * レジストリの `trDate` なので、何日も前に成立していた移管を今日はじめて検知した行は
 * 書き込んだ瞬間に期限切れになり、一度も再試行されずに終わってしまう。
 */
async function retryImport(
  db: Db,
  row: TransferRow,
  forceImportRetry: boolean,
  now: Date,
): Promise<TransferRow> {
  const cached = await getDomainStore().find(row.domainName);
  if (cached && cached.userId === row.userId && cached.ownership === "owned") {
    // DB に保有行がある = レジストリを叩かずに紐付け直すだけで済む
    return importApprovedTransfer(db, row, cached.info, cached.syncedAt);
  }
  const checkedAt = readStoredRaw(row.raw).checkedAt;
  const detectedAt = checkedAt
    ? new Date(checkedAt)
    : (row.completedAt ?? row.createdAt);
  if (
    !forceImportRetry &&
    now.getTime() - detectedAt.getTime() > IMPORT_RETRY_WINDOW_MS
  ) {
    return row;
  }
  const info = await adapterForDomain(row.domainName).info(row.domainName);
  return importApprovedTransfer(db, row, info, now);
}

/** 1 件を照合する。レジストリ由来の例外はそのまま投げる（呼び出し側が行単位で握る）。 */
async function reconcileRow(
  db: Db,
  row: TransferRow,
  options: { forceImportRetry: boolean },
): Promise<TransferRow> {
  const now = new Date();
  if (row.status === "approved") {
    return retryImport(db, row, options.forceImportRetry, now);
  }

  const adapter = adapterForDomain(row.domainName);
  const queried = await adapter.transferQuery(row.domainName);

  if (queried.status === "rejected" || queried.status === "cancelled") {
    return markClosed(db, row, queried.status, queried, now);
  }
  if (queried.status === "pending") {
    return touchPending(db, row, queried, adapter.registrarId, now);
  }

  // approved（Poll 由来のアダプタが入ったときの経路）と none（申請が消えた）はどちらも
  // info を引いて確かめる。実アダプタでは transferQuery 自体が info の導出なので同じ読みを
  // 2 回することになるが、これが起きるのは 1 件の移管につき 1 回だけなのでコストは許容する。
  const info = await adapter.info(row.domainName);
  if (queried.status !== "approved" && !isApprovedByInfo(row, info)) {
    return touchPending(db, row, queried, adapter.registrarId, now);
  }
  return importApprovedTransfer(
    db,
    await markApproved(db, row, info, queried, now),
    info,
    now,
  );
}

/**
 * 進行中の移管をレジストリと照合する（§10.1 / AC-12-3）。
 *
 * 1 件の失敗で一覧全体を落とさない（AC-03-2 / AC-07-2 と同じ部分失敗の方針）。
 * 失敗した行は照合前の値のまま返し、警告ログだけ残す。
 */
export async function reconcileTransfers(
  db: Db,
  rows: TransferRow[],
  options: { forceImportRetry?: boolean } = {},
): Promise<TransferRow[]> {
  const targets = rows.filter(needsReconcile);
  const budget = targets.slice(0, RECONCILE_LIMIT);
  if (targets.length > budget.length) {
    warn("transfer_reconcile_truncated", {
      total: targets.length,
      reconciled: budget.length,
    });
  }
  const targetIds = new Set(budget.map((row) => row.id));

  const reconciled = new Map<string, TransferRow>();
  await Promise.all(
    budget.map(async (row) => {
      try {
        reconciled.set(
          row.id,
          await reconcileRow(db, row, {
            forceImportRetry: options.forceImportRetry ?? false,
          }),
        );
      } catch (err) {
        // レジストリに繋がらない・未対応 TLD・想定外の例外。行は据え置いてログだけ残す
        warn("transfer_reconcile_failed", {
          transferId: row.id,
          domain: row.domainName,
          registry: row.registry,
          code:
            err instanceof RegistryError || err instanceof ApiException
              ? err.code
              : "INTERNAL",
          message: err instanceof Error ? err.message.slice(0, 300) : null,
        });
      }
    }),
  );

  return rows.map((row) =>
    targetIds.has(row.id) ? (reconciled.get(row.id) ?? row) : row,
  );
}
