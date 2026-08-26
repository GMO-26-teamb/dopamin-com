import {
  type AuthUser,
  authUserSchema,
  type PasskeySummary,
  passkeySummarySchema,
} from "@dopamin/shared";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { z } from "zod";

// SimpleWebAuthn v13 の引数型から options の型を導出する（バージョン追従のため）
type RegistrationOptionsJSON = Parameters<
  typeof startRegistration
>[0]["optionsJSON"];
type AuthenticationOptionsJSON = Parameters<
  typeof startAuthentication
>[0]["optionsJSON"];

export { browserSupportsWebAuthn };

export class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

// ---- 応答スキーマ（外部入力は zod で検証してから使う。CLAUDE.md 規約） ----

/**
 * options 応答は最低限の形だけ見る（FR-01 spec §12.4）。
 * `options` の中身は SimpleWebAuthn の CreationOptionsJSON / RequestOptionsJSON で、
 * ブラウザ API に渡す前に `startRegistration` / `startAuthentication` が自分で解釈する。
 */
const optionsResponseSchema = z.object({
  challengeId: z.uuid(),
  options: z.looseObject({ challenge: z.string().min(1) }),
});
const userResponseSchema = z.object({ user: authUserSchema });
const passkeyResponseSchema = z.object({ passkey: passkeySummarySchema });
const passkeysResponseSchema = z.object({
  passkeys: z.array(passkeySummarySchema),
});
const okResponseSchema = z.object({ ok: z.boolean() });

/**
 * 同一オリジンの /api/*（next.config.ts の rewrites で API に転送）を叩く。
 * エラーは統一エラー形式（§10.3）を ApiRequestError に変換し、
 * 成功応答は schema で検証してから返す（形が違えば INTERNAL）。
 */
async function request<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)
      ?.error;
    throw new ApiRequestError(
      err?.code ?? "INTERNAL",
      err?.message ?? "エラーが発生しました。",
    );
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    // 200 なのに形が違うのは自前 API 側の問題（lib/api/http/client.ts の unwrap と同じ扱い）
    throw new ApiRequestError(
      "INTERNAL",
      "API の応答が想定した形式ではありませんでした。",
    );
  }
  return parsed.data;
}

// ---- サインアップ（FR-01 spec §3.1） ----
export async function signupWithPasskey(
  displayName: string,
): Promise<AuthUser> {
  const { challengeId, options } = await request(
    "POST",
    "/api/v1/auth/passkey/register/options",
    optionsResponseSchema,
    { displayName },
  );
  const response = await startRegistration({
    optionsJSON: options as unknown as RegistrationOptionsJSON,
  });
  const { user } = await request(
    "POST",
    "/api/v1/auth/passkey/register/verify",
    userResponseSchema,
    { challengeId, response },
  );
  return user;
}

// ---- ログイン（FR-01 spec §3.2、ユーザー名入力なし） ----
export async function loginWithPasskey(): Promise<AuthUser> {
  const { challengeId, options } = await request(
    "POST",
    "/api/v1/auth/passkey/login/options",
    optionsResponseSchema,
    {},
  );
  const response = await startAuthentication({
    optionsJSON: options as unknown as AuthenticationOptionsJSON,
  });
  const { user } = await request(
    "POST",
    "/api/v1/auth/passkey/login/verify",
    userResponseSchema,
    { challengeId, response },
  );
  return user;
}

// ---- パスキー追加（FR-01 spec §3.3） ----
export async function addPasskey(): Promise<PasskeySummary> {
  const { challengeId, options } = await request(
    "POST",
    "/api/v1/auth/passkeys/register/options",
    optionsResponseSchema,
    {},
  );
  const response = await startRegistration({
    optionsJSON: options as unknown as RegistrationOptionsJSON,
  });
  const { passkey } = await request(
    "POST",
    "/api/v1/auth/passkeys/register/verify",
    passkeyResponseSchema,
    { challengeId, response },
  );
  return passkey;
}

// ---- セッション・管理 ----
export async function logout(): Promise<void> {
  await request("POST", "/api/v1/auth/logout", okResponseSchema, {});
}

export async function fetchPasskeys(): Promise<PasskeySummary[]> {
  const { passkeys } = await request(
    "GET",
    "/api/v1/auth/passkeys",
    passkeysResponseSchema,
  );
  return passkeys;
}

export async function deletePasskeyById(id: string): Promise<void> {
  await request(
    "DELETE",
    `/api/v1/auth/passkeys/${encodeURIComponent(id)}`,
    okResponseSchema,
  );
}

/** PATCH /auth/passkeys/:id（FR-01 spec §3.4）。更新後の PasskeySummary を返す */
export async function renamePasskeyById(
  id: string,
  name: string,
): Promise<PasskeySummary> {
  const { passkey } = await request(
    "PATCH",
    `/api/v1/auth/passkeys/${encodeURIComponent(id)}`,
    passkeyResponseSchema,
    { name },
  );
  return passkey;
}
