import type { AuthUser, PasskeySummary } from "@dopamin/shared";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

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

/**
 * 同一オリジンの /api/*（next.config.ts の rewrites で API に転送）を叩く。
 * エラーは統一エラー形式（§10.3）を ApiRequestError に変換する。
 */
async function request<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
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
  return data as T;
}

// ---- サインアップ（FR-01 spec §3.1） ----
export async function signupWithPasskey(
  displayName: string,
): Promise<AuthUser> {
  const { challengeId, options } = await request<{
    challengeId: string;
    options: RegistrationOptionsJSON;
  }>("POST", "/api/v1/auth/passkey/register/options", { displayName });
  const response = await startRegistration({ optionsJSON: options });
  const { user } = await request<{ user: AuthUser }>(
    "POST",
    "/api/v1/auth/passkey/register/verify",
    { challengeId, response },
  );
  return user;
}

// ---- ログイン（FR-01 spec §3.2、ユーザー名入力なし） ----
export async function loginWithPasskey(): Promise<AuthUser> {
  const { challengeId, options } = await request<{
    challengeId: string;
    options: AuthenticationOptionsJSON;
  }>("POST", "/api/v1/auth/passkey/login/options", {});
  const response = await startAuthentication({ optionsJSON: options });
  const { user } = await request<{ user: AuthUser }>(
    "POST",
    "/api/v1/auth/passkey/login/verify",
    { challengeId, response },
  );
  return user;
}

// ---- パスキー追加（FR-01 spec §3.3） ----
export async function addPasskey(): Promise<PasskeySummary> {
  const { challengeId, options } = await request<{
    challengeId: string;
    options: RegistrationOptionsJSON;
  }>("POST", "/api/v1/auth/passkeys/register/options", {});
  const response = await startRegistration({ optionsJSON: options });
  const { passkey } = await request<{ passkey: PasskeySummary }>(
    "POST",
    "/api/v1/auth/passkeys/register/verify",
    { challengeId, response },
  );
  return passkey;
}

// ---- セッション・管理 ----
export async function logout(): Promise<void> {
  await request<{ ok: boolean }>("POST", "/api/v1/auth/logout", {});
}

export async function fetchMe(): Promise<AuthUser | null> {
  try {
    const { user } = await request<{ user: AuthUser }>(
      "GET",
      "/api/v1/auth/me",
    );
    return user;
  } catch {
    return null;
  }
}

export async function fetchPasskeys(): Promise<PasskeySummary[]> {
  const { passkeys } = await request<{ passkeys: PasskeySummary[] }>(
    "GET",
    "/api/v1/auth/passkeys",
  );
  return passkeys;
}

export async function deletePasskeyById(id: string): Promise<void> {
  await request<{ ok: boolean }>(
    "DELETE",
    `/api/v1/auth/passkeys/${encodeURIComponent(id)}`,
  );
}
