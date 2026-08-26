import {
  toTransferResponse,
  transferCreateRequestSchema,
  transferIdParamSchema,
} from "@dopamin/shared";
import { Hono } from "hono";
import { ApiException } from "../lib/errors";
import { reconcileOnTimeout } from "../lib/reconcile";
import { adapterForDomain } from "../lib/registries";
import { jsonValidator } from "../lib/validator";
import { requireSession } from "../middleware/session";
import { consumePoll } from "../services/poll.service";
import {
  actOnTransfer,
  getTransfer,
  listTransfers,
  recordInboundTransferRequest,
  toTransferSummary,
} from "../services/transfer.service";
import type { AuthedEnv } from "../types";

/** `:id` の検証。uuid 以外（旧パスのドメイン名を含む）は 400 で弾く。 */
function parseTransferIdParam(raw: string): string {
  const parsed = transferIdParamSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiException("VALIDATION_ERROR", "移管 ID の形式が不正です。");
  }
  return parsed.data;
}

export const transfers = new Hono<AuthedEnv>()
  // NFR-04 / AC-01-3: 移管操作も認証必須（対象ドメインの所有権は移管の性質上ここでは見ない）
  .use(requireSession)

  /**
   * FR-12: 移管 IN 申請。受理されると pendingTransfer になる（放置時は 20 分後に自動承認）。
   * 受理した申請は `transfers(direction = in, status = pending)` として永続化し、
   * `/transfers` に「移管申請中」として出す。`domains` 行はまだ作らない（AC-12-1）。
   * 応答は正規化 `TransferResult` から `raw`（レジストリ生応答）を除いた DTO（FR-18 / ADR-0002）。
   */
  .post("/", jsonValidator(transferCreateRequestSchema), async (c) => {
    const { name, authCode } = c.req.valid("json");
    const adapter = adapterForDomain(name);
    // AC-18-2: タイムアウト時は transferQuery（info 導出）で受理済みかを照合する
    const transfer = await reconcileOnTimeout(
      () => adapter.transferRequest(name, authCode),
      async () => {
        const queried = await adapter.transferQuery(name);
        return queried.status === "pending" ? queried : null;
      },
    );
    const record = await recordInboundTransferRequest(
      c.get("user").id,
      adapter,
      transfer,
    );
    return c.json(
      {
        transfer: toTransferResponse(transfer),
        record: toTransferSummary(record),
      },
      202,
    );
  })

  /**
   * FR-12: 移管一覧（AC-12-1 / AC-12-3）。
   * 進行中の行を `transferQuery` で照会して DB に反映し、IN / OUT / 履歴に分けて返す。
   */
  .get("/", async (c) => {
    // §10.1「表示時に Poll を消化」。承認 / 拒否 / 取消を区別できるのは Poll だけ
    // （ADR-0002 決定 1）なので、行を読む前に消化して DB を最新にする。
    // 失敗はまとめて返るだけで例外にはならないため、レジストリが落ちていても一覧は返る
    await consumePoll();
    return c.json(await listTransfers(c.get("user").id));
  })

  /**
   * FR-12: 移管 1 件の状態照会（§10.1）。承認を検知したら `info` で取り込み、
   * `domains` 行を作って `domain_id` を紐付ける（§6.5）。
   */
  .get("/:id", async (c) => {
    const id = parseTransferIdParam(c.req.param("id"));
    return c.json({ transfer: await getTransfer(c.get("user").id, id) });
  })

  /**
   * FR-12 / AC-12-4 / AC-12-5: 受信した移管申請（`direction = out`）を承認する。
   * 承認したドメインは `ownership = 'transferred_out'` になり保有一覧から消える。
   */
  .post("/:id/approve", async (c) => {
    const id = parseTransferIdParam(c.req.param("id"));
    return c.json({
      transfer: await actOnTransfer(c.get("user").id, id, "approve"),
    });
  })

  /** FR-12 / AC-12-4: 受信した移管申請を拒否する。保有は動かない。 */
  .post("/:id/reject", async (c) => {
    const id = parseTransferIdParam(c.req.param("id"));
    return c.json({
      transfer: await actOnTransfer(c.get("user").id, id, "reject"),
    });
  })

  /** FR-12（P1）: 自分が出した移管 IN 申請を承認前に取り消す（`direction = in`）。 */
  .post("/:id/cancel", async (c) => {
    const id = parseTransferIdParam(c.req.param("id"));
    return c.json({
      transfer: await actOnTransfer(c.get("user").id, id, "cancel"),
    });
  });
