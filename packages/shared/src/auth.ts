import { z } from "zod";

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

export type AuthUser = z.infer<typeof authUserSchema>;
export type PasskeySummary = z.infer<typeof passkeySummarySchema>;
export type RegisterOptionsRequest = z.infer<
  typeof registerOptionsRequestSchema
>;
export type PasskeyVerifyRequest = z.infer<typeof passkeyVerifyRequestSchema>;
