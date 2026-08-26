import { z } from "zod";
import { aiSettingsSchema } from "./ai";

// 表示名: 1〜32 文字（FR-01 / AC 参照）。前後の空白は除去し、空白のみは拒否する
export const displayNameSchema = z.string().trim().min(1).max(32);

/**
 * ブラウザから返る WebAuthn レスポンスの最低限の形（FR-01 spec §4）。
 * 暗号学的な検証は SimpleWebAuthn に任せ、ここでは「渡してよい形か」だけを確認する。
 */
export const webauthnResponseSchema = z.object({
  id: z.string().min(1),
  rawId: z.string().min(1),
  type: z.literal("public-key"),
  response: z.record(z.string(), z.unknown()),
  clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
  authenticatorAttachment: z.string().optional(),
});

// POST /auth/passkey/register/options
export const registerOptionsRequestSchema = z.object({
  displayName: displayNameSchema,
});

// POST /auth/passkey/{register,login}/verify（共通の形）
export const passkeyVerifyRequestSchema = z.object({
  challengeId: z.uuid(),
  response: webauthnResponseSchema,
});

export const authUserSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
});

// GET /auth/passkeys の 1 要素（日時は ISO 文字列）
export const passkeySummarySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  deviceType: z.string().nullable(),
  backedUp: z.boolean().nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});

// パスキーの表示名: 表示名と同じ 1〜32 文字（FR-01 spec §3.4）。前後の空白は除去し、空白のみは拒否する
export const passkeyNameSchema = z.string().trim().min(1).max(32);

// PATCH /auth/passkeys/:id
export const passkeyRenameRequestSchema = z.object({
  name: passkeyNameSchema,
});

/**
 * `GET /auth/me` のレスポンス（FR-01 / FR-16 / FR-17）。
 *
 * 画面が起動時に必要とする「ユーザー + 有効な機能 + AI 設定」をまとめて返す。
 * - `features.demoReset`: `DEMO_RESET_ENABLED` の値。false なら設定画面のリセットカードを出さない（AC-16-1）
 * - `ai`: FR-17 の現在値と選択肢（{@link aiSettingsSchema}）
 *
 * この 2 つを `/auth/me` に載せるのは `docs/specs/ui-screens.md` §7 の要確認 #2 / #3 の
 * 仮置きに従ったもの（requirements.md §10.1 には未記載）。`GET /settings/ai` を
 * 別に生やす決定になった場合は `ai` をそちらへ移す。
 * 現状の `apps/api` の `/auth/me` は `{ user }` だけを返すため、
 * このスキーマを満たすのは FR-16 / FR-17 の実装後になる。
 */
export const meResponseSchema = z.object({
  user: authUserSchema,
  features: z.object({
    demoReset: z.boolean(),
  }),
  ai: aiSettingsSchema,
});

export type MeResponse = z.infer<typeof meResponseSchema>;
export type AuthUser = z.infer<typeof authUserSchema>;
export type PasskeySummary = z.infer<typeof passkeySummarySchema>;
export type RegisterOptionsRequest = z.infer<
  typeof registerOptionsRequestSchema
>;
export type PasskeyVerifyRequest = z.infer<typeof passkeyVerifyRequestSchema>;
export type PasskeyRenameRequest = z.infer<typeof passkeyRenameRequestSchema>;
