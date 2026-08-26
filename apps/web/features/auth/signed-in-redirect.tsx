"use client";

/**
 * ログイン済みの人が `/`（S-00）や `/login`（S-02）に来たら `/dashboard` へ送る（ui-screens §3）。
 *
 * 何も描かない副作用だけのコンポーネント。判定は `useMe({ probe: true })`（`GET /auth/me`）:
 * - http … セッション Cookie が有効なら成功する。401 は「未ログイン」の正常系なので、
 *   `probe` で `/login?reason=expired` への誘導（`lib/api/query-client.tsx`）を抑止する。
 * - mock … `me` は常に成功するため、「このタブでモックログインした」目印も条件に入れる。
 *   目印を条件に入れないとモックでは常にログイン済み扱いになり、S-00 / S-01 / S-02 を
 *   確認できなくなる（`features/auth/session.ts` の説明を参照）。
 *
 * `API_MODE` はビルド時に決まる定数なので、判定条件は実行中に変わらない。
 */

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useMe } from "@/lib/api/hooks";
import { API_MODE } from "@/lib/api/mode";
import { DEFAULT_NEXT_PATH } from "./next-path";
import { hasAuthSession } from "./session";

export interface SignedInRedirectProps {
  /** 行き先。既定は S-10 / S-11 */
  to?: string;
}

export function SignedInRedirect({
  to = DEFAULT_NEXT_PATH,
}: SignedInRedirectProps) {
  const router = useRouter();
  const me = useMe({ probe: true });
  const signedIn = me.isSuccess && (API_MODE === "http" || hasAuthSession());

  useEffect(() => {
    if (signedIn) {
      router.replace(to);
    }
  }, [router, signedIn, to]);

  return null;
}
