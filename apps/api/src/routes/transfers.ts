import { type RegistryAdapter, RegistryError } from "@dopamin/registry";
import {
  type TransferResult,
  toTransferResponse,
  transferCreateRequestSchema,
  transferIdParamSchema,
} from "@dopamin/shared";
import { Hono } from "hono";
import { getDb } from "../lib/db";
import { ApiException } from "../lib/errors";
import { getRequestContext } from "../lib/operation-log-context";
import { reconcileOnTimeout } from "../lib/reconcile";
import { adapterForDomain } from "../lib/registries";
import { jsonValidator } from "../lib/validator";
import { requireSession } from "../middleware/session";
import {
  listUserTransferRows,
  reconcileTransfers,
  recordInboundTransferRequest,
  requireOwnedTransfer,
  toTransfersListResponse,
} from "../services/transfer.service";
import { toTransferSummary } from "../services/transfer-row";
import type { AuthedEnv } from "../types";

/**
 * 申請結果を `transfers` に記録する（§6.5 の write-through）。
 *
 * レジストリが受理した後の DB 書き込み失敗は、レジストリ操作の成否に影響させない。
 * 操作ログ（`lib/registries.ts` の operation_log_write_failed）と同じ流儀で構造化ログに落とし、
 * 例外はここで止める。行が無いままでも同じドメインに再申請すれば作り直せる。
 */
async function recordRequest(
  userId: string,
  name: string,
  adapter: RegistryAdapter,
  result: TransferResult | null,
  startedAt: Date,
): Promise<void> {
  try {
    await recordInboundTransferRequest(getDb(), {
      userId,
      name,
      registry: adapter.id,
      selfRegistrarId: adapter.registrarId,
      result,
      startedAt,
    });
  } catch (cause) {
    console.error(
      JSON.stringify({
        level: "error",
        type: "transfer_row_write_failed",
        requestId: getRequestContext().requestId,
        domain: name,
        registry: adapter.id,
        message: (cause instanceof Error ? cause.message : String(cause)).slice(
          0,
          300,
        ),
      }),
    );
  }
}

export const transfers = new Hono<AuthedEnv>()
  // NFR-04 / AC-01-3: 移管操作も認証必須。所有権は対象ドメインではなく `transfers.user_id` で見る
  // （移管 IN は申請時点で `domains` 行が無く、requireOwnedDomain だと必ず 404 になる。§6.5）
  .use(requireSession)

  /**
   * FR-12: 移管 IN 申請。受理されると pendingTransfer になる（放置時は 20 分後に自動承認）。
   * 受理を `transfers(direction = in, status = pending)` に記録し、`domains` 行は作らない
   * （AC-12-1: 保有一覧には出さず `/transfers` に「移管申請中」として出す）。
   * 応答は正規化 `TransferResult` から `raw`（レジストリ生応答）を除いた DTO（FR-18 / ADR-0002）。
   */
  .post("/", jsonValidator(transferCreateRequestSchema), async (c) => {
    const { name, authCode } = c.req.valid("json");
    const userId = c.get("user").id;
    const adapter = adapterForDomain(name);
    // 申請を送り始めた時刻。レジストリが reDate を返さない場合の requested_at に使う。
    // 応答を待った時間（タイムアウトなら 15 秒 + 照合分）だけ後ろにずれた「今」を使うと、
    // 待っている間に成立した移管を承認として検知できなくなる。
    const startedAt = new Date();

    let transfer: TransferResult;
    try {
      // AC-18-2: タイムアウト時は transferQuery（info 導出）で受理済みかを照合する
      transfer = await reconcileOnTimeout(
        () => adapter.transferRequest(name, authCode),
        async () => {
          const queried = await adapter.transferQuery(name);
          return queried.status === "pending" ? queried : null;
        },
      );
    } catch (err) {
      // 受理を確認できないタイムアウトでも行だけは残す（ADR-0002 の宿題を #56 で解消）。
      // `transferQuery` は「申請が届いていない」と「届いたが既に完了した」を区別できないため、
      // 行が無いと後者を永久に取りこぼす。次回の `/transfers` 照合が拾えるようにしておく。
      if (err instanceof RegistryError && err.code === "REGISTRY_TIMEOUT") {
        await recordRequest(userId, name, adapter, null, startedAt);
      }
      throw err;
    }

    await recordRequest(userId, name, adapter, transfer, startedAt);
    return c.json({ transfer: toTransferResponse(transfer) }, 202);
  })

  /**
   * FR-12 / AC-12-3: 移管一覧。DB の全行を返し、進行中の移管 IN だけレジストリと照合する。
   * 承認を検知した行は `info` を取り込んで `domains` 行を作り、`domain_id` を紐付ける（§6.5）。
   *
   * §10.1 の「表示時に Poll も消化する」はアダプタの `poll` / `ackMessage`（#44）と
   * Poll サービス（#58）が入ってから足す。そのため `direction = out` の行は当面できない。
   */
  .get("/", async (c) => {
    const db = getDb();
    const rows = await listUserTransferRows(db, c.get("user").id);
    return c.json(toTransfersListResponse(await reconcileTransfers(db, rows)));
  })

  /**
   * FR-12: 移管 1 件の状態照会（§10.1）。一覧と同じ照合を 1 行だけ行う。
   * ユーザーが明示的に叩く導線なので、取り込みの再試行には時間制限を掛けない。
   */
  .get("/:id", async (c) => {
    const parsed = transferIdParamSchema.safeParse(c.req.param("id"));
    if (!parsed.success) {
      throw new ApiException("VALIDATION_ERROR", "移管 ID の形式が不正です。");
    }
    const db = getDb();
    const row = await requireOwnedTransfer(db, c.get("user").id, parsed.data);
    const [reconciled] = await reconcileTransfers(db, [row], {
      forceImportRetry: true,
    });
    return c.json({ transfer: toTransferSummary(reconciled ?? row) });
  });
