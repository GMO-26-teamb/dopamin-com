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
import {
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
    return c.json(await listTransfers(c.get("user").id));
  })

  /**
   * FR-12: 移管 1 件の状態照会（§10.1）。承認を検知したら `info` で取り込み、
   * `domains` 行を作って `domain_id` を紐付ける（§6.5）。
   */
  .get("/:id", async (c) => {
    const id = parseTransferIdParam(c.req.param("id"));
    return c.json({ transfer: await getTransfer(c.get("user").id, id) });
  });
