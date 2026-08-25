import { domainNameSchema, transferCreateRequestSchema } from "@dopamin/shared";
import { Hono } from "hono";
import { ApiError } from "../lib/api-error";
import { reconcileOnTimeout } from "../lib/reconcile";
import { adapterForDomain } from "../lib/registries";
import { jsonValidator } from "../lib/validator";
import type { AppEnv } from "../types";

export const transfers = new Hono<AppEnv>()
  /** FR-12: 移管 IN 申請。受理されると pendingTransfer になる（放置時は 20 分後に自動承認）。 */
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
    return c.json({ transfer }, 202);
  })

  /**
   * FR-12: 移管状態の照会。レジストリに transfer query 専用エンドポイントが無いため、
   * ドメイン名で `info` を引き pendingTransfer の有無から導出する（DB 導入後に一覧化する）。
   */
  .get("/:name", async (c) => {
    const parsed = domainNameSchema.safeParse(c.req.param("name"));
    if (!parsed.success) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "ドメイン名の形式が不正です。",
      );
    }
    const transfer = await adapterForDomain(parsed.data).transferQuery(
      parsed.data,
    );
    return c.json({ transfer });
  });
