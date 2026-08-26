import { aiSettingsUpdateRequestSchema } from "@dopamin/shared";
import { Hono } from "hono";
import { getDb } from "../lib/db";
import { jsonValidator } from "../lib/validator";
import { requireSession } from "../middleware/session";
import { updateAiSettings } from "../services/settings";
import type { AuthedEnv } from "../types";

/**
 * 設定（requirements §10.1 `/settings/*`）。全ルート認証必須。
 * 取得側は `GET /auth/me` の `ai` に同居させている（FR-17。専用の GET は持たない）。
 */
export const settings = new Hono<AuthedEnv>()
  .use(requireSession)
  /**
   * PATCH /settings/ai（FR-17）: `users.ai_provider / ai_model` を更新して実効値を返す。
   * 有効化されていないプロバイダは VALIDATION_ERROR（services/settings.ts）。
   */
  .patch("/ai", jsonValidator(aiSettingsUpdateRequestSchema), async (c) => {
    const ai = await updateAiSettings(
      getDb(),
      c.get("user").id,
      c.req.valid("json"),
    );
    return c.json(ai);
  });
