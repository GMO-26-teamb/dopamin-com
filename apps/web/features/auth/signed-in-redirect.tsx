"use client";

/**
 * ログイン済みの人が `/`（S-00）や `/login`（S-02）に来たら `/dashboard` へ送る（ui-screens §3）。
 *
 * 何も描かない副作用だけのコンポーネント。判定は API モードで変える:
 * - http … セッション Cookie の実物を `GET /auth/me` で確かめる（`lib/webauthn.ts` の `fetchMe`）。
 *   `settings.me()`（`useMe`）は HTTP 実装がまだ `NOT_IMPLEMENTED` なので使えない。
 * - mock … `useMe()` が成功し、かつ「このタブでモックログインした」目印がある場合だけ。
 *   目印を条件に入れないとモックでは常にログイン済み扱いになり、S-00 / S-01 / S-02 を
 *   確認できなくなる（`features/auth/session.ts` の説明を参照）。
 *
 * `API_MODE` はビルド時に決まる定数なので、どちらの実装が使われるかは実行中に変わらない。
 */

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useMe } from "@/lib/api/hooks";
import { API_MODE } from "@/lib/api/mode";
import { fetchMe } from "@/lib/webauthn";
import { DEFAULT_NEXT_PATH } from "./next-path";
import { hasAuthSession } from "./session";

export interface SignedInRedirectProps {
  /** 行き先。既定は S-10 / S-11 */
  to?: string;
}

export function SignedInRedirect({
  to = DEFAULT_NEXT_PATH,
}: SignedInRedirectProps) {
  return API_MODE === "http" ? (
    <CookieSessionRedirect to={to} />
  ) : (
    <MockSessionRedirect to={to} />
  );
}

function CookieSessionRedirect({ to }: { to: string }) {
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    void fetchMe().then((user) => {
      if (alive && user !== null) {
        router.replace(to);
      }
    });
    return () => {
      alive = false;
    };
  }, [router, to]);

  return null;
}

function MockSessionRedirect({ to }: { to: string }) {
  const router = useRouter();
  const me = useMe();
  const signedIn = me.isSuccess;

  useEffect(() => {
    if (signedIn && hasAuthSession()) {
      router.replace(to);
    }
  }, [router, signedIn, to]);

  return null;
}
