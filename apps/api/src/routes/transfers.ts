import {
  domainNameSchema,
  toTransferResponse,
  transferCreateRequestSchema,
} from "@dopamin/shared";
import { Hono } from "hono";
import { ApiException } from "../lib/errors";
import { reconcileOnTimeout } from "../lib/reconcile";
import { adapterForDomain } from "../lib/registries";
import { jsonValidator } from "../lib/validator";
import { requireSession } from "../middleware/session";
import { requireNotOwnedByOtherUser } from "../services/domain.service";
import type { AuthedEnv } from "../types";

export const transfers = new Hono<AuthedEnv>()
  // NFR-04 / AC-01-3: 移管操作も認証必須。所有権は requireNotOwnedByOtherUser で個別に見る
  // （移管 IN の対象は本アプリに domains 行を持たないため「保有必須」にはできない）
  .use(requireSession)
  /**
   * FR-12: 移管 IN 申請。受理されると pendingTransfer になる（放置時は 20 分後に自動承認）。
   * 応答は正規化 `TransferResult` から `raw`（レジストリ生応答）を除いた DTO（FR-18 / ADR-0002）。
   */
  .post("/", jsonValidator(transferCreateRequestSchema), async (c) => {
    const { name, authCode } = c.req.valid("json");
    // 未対応 TLD は所有権を引く前に 400 で弾く（入力検証が先）
    const adapter = adapterForDomain(name);
    // NFR-04: 他ユーザーが保有中のドメインは移管 IN の対象にできない（§2.2: 同一レジストラ内の
    // 所有者変更は EPP 移管にならない）。行が無い＝移管 IN の通常ケースなので通す
    await requireNotOwnedByOtherUser(c.get("user").id, name);
    // AC-18-2: タイムアウト時は transferQuery（info 導出）で受理済みかを照合する
    const transfer = await reconcileOnTimeout(
      () => adapter.transferRequest(name, authCode),
      async () => {
        const queried = await adapter.transferQuery(name);
        return queried.status === "pending" ? queried : null;
      },
    );
    return c.json({ transfer: toTransferResponse(transfer) }, 202);
  })

  /**
   * FR-12: 移管状態の照会。レジストリに transfer query 専用エンドポイントが無いため、
   * ドメイン名で `info` を引き pendingTransfer の有無から導出する（DB 導入後に一覧化する）。
   */
  .get("/:name", async (c) => {
    const parsed = domainNameSchema.safeParse(c.req.param("name"));
    if (!parsed.success) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "ドメイン名の形式が不正です。",
      );
    }
    const adapter = adapterForDomain(parsed.data);
    // NFR-04: 他ユーザーが保有中のドメインの移管状態は照会させない。
    // 申請中の移管 IN はまだ domains 行を持たないため、行が無いのは正常
    await requireNotOwnedByOtherUser(c.get("user").id, parsed.data);
    const transfer = await adapter.transferQuery(parsed.data);
    return c.json({ transfer: toTransferResponse(transfer) });
  });
