"use client";

/**
 * パスキー認証（FR-01 / S-01・S-02）を画面から使うための hook。
 *
 * 実装は `useServices().auth`（`AuthService`）に任せる:
 * - http モード … `lib/api/http/http-services.ts` が既存の `lib/webauthn.ts`
 *   （`signupWithPasskey` / `loginWithPasskey` / `browserSupportsWebAuthn`）を呼ぶ
 * - mock モード … `lib/api/mock/mock-services.ts` が常に成功する（実 API 無しで画面を確認できる）
 *
 * 失敗の文言はキャンセル / タイムアウト / 非対応を区別しない（ui-screens S-01b / S-02b）。
 * 例外は表示名のバリデーション（`VALIDATION_ERROR`）で、これだけ Input の Helper に出す。
 */

import type { AuthUser } from "@dopamin/shared";
import { useCallback, useEffect, useState } from "react";
import { toApiClientError } from "@/lib/api/errors";
import { useServices } from "@/lib/api/provider";
import { startAuthSession } from "./session";

/** 表示名の長さ（AC-01-1、ui-screens S-01）。サーバー側でも同じ範囲で弾く。 */
export const DISPLAY_NAME_MIN = 1;
export const DISPLAY_NAME_MAX = 32;

export const DISPLAY_NAME_ERROR = `表示名は ${DISPLAY_NAME_MIN}〜${DISPLAY_NAME_MAX} 文字で入力してください`;

/** クライアント側の表示名バリデーション。問題なければ `null`。 */
export function validateDisplayName(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length >= DISPLAY_NAME_MIN &&
    trimmed.length <= DISPLAY_NAME_MAX
    ? null
    : DISPLAY_NAME_ERROR;
}

/** `window.PublicKeyCredential` の有無。SSR では判定できないので `unknown` から始める。 */
export type PasskeySupport = "unknown" | "supported" | "unsupported";

/**
 * 非対応環境の判定（AC-01-5、S-01c / S-02c）。
 * サーバーとクライアントで結果が変わる値なので、マウント後に一度だけ問い合わせる。
 */
export function usePasskeySupport(): PasskeySupport {
  const services = useServices();
  const [support, setSupport] = useState<PasskeySupport>("unknown");

  useEffect(() => {
    setSupport(services.auth.isSupported() ? "supported" : "unsupported");
  }, [services]);

  return support;
}

export interface PasskeyAuth {
  support: PasskeySupport;
  /** 認証中。ボタンを Disabled にしてラベルを「〜中…」にする（ui-screens §4） */
  pending: boolean;
  /** S-01b / S-02b の Banner Warn を出すか */
  failed: boolean;
  /** 表示名の `VALIDATION_ERROR`。Input の Helper に出す */
  fieldError: string | null;
  /** 成功したら true。呼び出し側が `next` へ遷移する */
  login: () => Promise<boolean>;
  signup: (displayName: string) => Promise<boolean>;
  /** 入力し直したときにエラー表示を消す */
  clearErrors: () => void;
}

export function usePasskeyAuth(): PasskeyAuth {
  const services = useServices();
  const support = usePasskeySupport();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const run = useCallback(
    async (call: () => Promise<AuthUser>): Promise<boolean> => {
      setPending(true);
      setFailed(false);
      setFieldError(null);
      try {
        await call();
        startAuthSession();
        // 成功時は pending のまま返す。遷移が終わるまでボタンを押せないようにする（二重送信防止）
        return true;
      } catch (e) {
        const error = toApiClientError(e);
        if (error.code === "VALIDATION_ERROR") {
          setFieldError(DISPLAY_NAME_ERROR);
        } else {
          setFailed(true);
        }
        setPending(false);
        return false;
      }
    },
    [],
  );

  const login = useCallback(
    () => run(() => services.auth.login()),
    [run, services],
  );

  const signup = useCallback(
    (displayName: string) => {
      const invalid = validateDisplayName(displayName);
      if (invalid !== null) {
        setFailed(false);
        setFieldError(invalid);
        return Promise.resolve(false);
      }
      return run(() => services.auth.signup(displayName.trim()));
    },
    [run, services],
  );

  const clearErrors = useCallback(() => {
    setFailed(false);
    setFieldError(null);
  }, []);

  return { support, pending, failed, fieldError, login, signup, clearErrors };
}
