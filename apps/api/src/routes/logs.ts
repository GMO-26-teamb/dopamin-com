import { paginationQuerySchema } from "@dopamin/shared";
import { Hono } from "hono";
import { getDb } from "../lib/db";
import { queryValidator } from "../lib/validator";
import { requireSession } from "../middleware/session";
import { listAiLogs, listOperationLogs } from "../services/log.service";
import type { AuthedEnv } from "../types";

/**
 * ログ一覧（docs/requirements.md §10.1 `/logs/*` / FR-14・FR-15）。
 * どちらも自分のログだけを新しい順に返すカーソルページング（絞り込みは service 側）。
 */
export const logs = new Hono<AuthedEnv>()
  // NFR-04: 他人のログは見せない。user_id での絞り込みは listAiLogs / listOperationLogs が行う
  .use(requireSession)

  /** FR-15: レジストリ通信ログ。request / response はマスク済みの値をそのまま返す（AC-15-2）。 */
  .get("/operations", queryValidator(paginationQuerySchema), async (c) => {
    return c.json(
      await listOperationLogs(getDb(), c.get("user").id, c.req.valid("query")),
    );
  })

  /** FR-14: AI 呼び出しログ（成功・失敗とも。AC-14-1）。 */
  .get("/ai", queryValidator(paginationQuerySchema), async (c) => {
    return c.json(
      await listAiLogs(getDb(), c.get("user").id, c.req.valid("query")),
    );
  });
