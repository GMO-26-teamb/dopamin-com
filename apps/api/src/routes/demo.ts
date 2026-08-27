import { Hono } from "hono";
import { getApiEnv } from "../lib/env";
import { ApiException } from "../lib/errors";
import { requireSession } from "../middleware/session";
import { resetDemoData } from "../services/demo.service";
import type { AuthedEnv } from "../types";

/**
 * デモデータリセット（docs/requirements.md FR-16 / §10.1 `POST /demo/reset`）。
 *
 * AC-16-1: `DEMO_RESET_ENABLED=true` の環境でのみ実行できる。無効な環境では
 * 「そんなエンドポイントは無い」= 404 を返す（403 だと存在を教えてしまう）。
 * クライアントには `GET /auth/me` の `features.demoReset` で可否を伝える。
 */
export const demo = new Hono<AuthedEnv>()
  .use(requireSession)

  .post("/reset", async (c) => {
    if (!getApiEnv().DEMO_RESET_ENABLED) {
      throw new ApiException(
        "NOT_FOUND",
        "デモデータリセットはこの環境では利用できません。",
      );
    }
    return c.json(await resetDemoData(c.get("user")));
  });
