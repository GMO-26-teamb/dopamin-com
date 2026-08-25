import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { env } from "./env";

export const SESSION_COOKIE = "dopamin_session";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 日

/** セッション Cookie（§12.3: HttpOnly / Secure / SameSite=Lax / 7 日） */
export function setSessionCookie(c: Context, sessionId: string): void {
  setCookie(c, SESSION_COOKIE, sessionId, {
    path: "/",
    httpOnly: true,
    // ローカル（http://localhost）では Secure を付けない
    secure: env().WEBAUTHN_ORIGIN.startsWith("https://"),
    sameSite: "Lax",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}
