import {
  passkeyRenameRequestSchema,
  passkeyVerifyRequestSchema,
  registerOptionsRequestSchema,
} from "@dopamin/shared";
import { Hono } from "hono";
import { clearSessionCookie, setSessionCookie } from "../lib/cookies";
import { getDb } from "../lib/db";
import { getApiEnv } from "../lib/env";
import { jsonValidator } from "../lib/validator";
import { requireSession } from "../middleware/session";
import {
  createAddPasskeyOptions,
  createAuthenticationOptions,
  createRegistrationOptions,
  deletePasskey,
  listPasskeys,
  renamePasskey,
  verifyAddPasskey,
  verifyAuthentication,
  verifyRegistration,
} from "../services/auth";
import { deleteSession } from "../services/session";
import { getAiSettingsForUser } from "../services/settings";

/**
 * zod 検証失敗を統一エラー形式（VALIDATION_ERROR）にする（#141 で `jsonValidator` に統一）。
 * 以前はこのファイルだけ `details: { issues: <zod の生 issue> }` の形で、
 * 他のルート（`lib/validator.ts`）は `details: [{ path, message }]` だった。
 * §10.3 は「issue の配列」を正としているうえ、zod の生 issue は
 * 入力値を含むことがあるのでクライアントには出さない（NFR-03）。
 */
const json = jsonValidator;

export const auth = new Hono()
  // ---- サインアップ ----
  .post(
    "/passkey/register/options",
    json(registerOptionsRequestSchema),
    async (c) => {
      const { displayName } = c.req.valid("json");
      const result = await createRegistrationOptions(getDb(), displayName);
      return c.json(result);
    },
  )
  .post(
    "/passkey/register/verify",
    json(passkeyVerifyRequestSchema),
    async (c) => {
      const { user, sessionId } = await verifyRegistration(
        getDb(),
        c.req.valid("json"),
        c.req.header("user-agent"),
      );
      setSessionCookie(c, sessionId);
      return c.json({ user });
    },
  )
  // ---- ログイン ----
  .post("/passkey/login/options", async (c) => {
    const result = await createAuthenticationOptions(getDb());
    return c.json(result);
  })
  .post(
    "/passkey/login/verify",
    json(passkeyVerifyRequestSchema),
    async (c) => {
      const { user, sessionId } = await verifyAuthentication(
        getDb(),
        c.req.valid("json"),
        c.req.header("user-agent"),
      );
      setSessionCookie(c, sessionId);
      return c.json({ user });
    },
  )
  // ---- セッション ----
  .post("/logout", requireSession, async (c) => {
    await deleteSession(getDb(), c.get("sessionId"));
    clearSessionCookie(c);
    return c.json({ ok: true });
  })
  /**
   * GET /auth/me（requirements §10.1、FR-01 / FR-16 / FR-17）。
   * 画面の起動時に必要な「ユーザー + 有効な機能 + AI 設定の実効値と選択肢」をまとめて返す
   * （packages/shared の `meResponseSchema` の形）。
   */
  .get("/me", requireSession, async (c) => {
    const user = c.get("user");
    const env = getApiEnv();
    const ai = await getAiSettingsForUser(getDb(), user.id, env);
    return c.json({
      user,
      features: { demoReset: env.DEMO_RESET_ENABLED },
      ai,
    });
  })
  // ---- パスキー管理 ----
  .get("/passkeys", requireSession, async (c) => {
    const passkeys = await listPasskeys(getDb(), c.get("user").id);
    return c.json({ passkeys });
  })
  .post("/passkeys/register/options", requireSession, async (c) => {
    const result = await createAddPasskeyOptions(getDb(), c.get("user"));
    return c.json(result);
  })
  .post(
    "/passkeys/register/verify",
    requireSession,
    json(passkeyVerifyRequestSchema),
    async (c) => {
      const passkey = await verifyAddPasskey(
        getDb(),
        c.get("user"),
        c.req.valid("json"),
      );
      return c.json({ passkey });
    },
  )
  .delete("/passkeys/:id", requireSession, async (c) => {
    await deletePasskey(getDb(), c.get("user").id, c.req.param("id"));
    return c.json({ ok: true });
  })
  .patch(
    "/passkeys/:id",
    requireSession,
    json(passkeyRenameRequestSchema),
    async (c) => {
      const passkey = await renamePasskey(
        getDb(),
        c.get("user").id,
        c.req.param("id"),
        c.req.valid("json").name,
      );
      return c.json({ passkey });
    },
  );
