import { type NextRequest, NextResponse } from "next/server";
import { API_MODE } from "@/lib/api/mode";

/**
 * 未認証で保護ページに来たら /login へリダイレクト（AC-01-3, FR-01 spec §8）。
 * ここでは Cookie の有無だけを見る軽いチェックに留め、
 * セッションの有効性検証は API 側の session ミドルウェアが行う。
 *
 * モックモード（既定）のときは素通しする。モックだけで全画面・全状態を
 * レビューできるようにするため（fe-ui 設計 §1）。モードの解決は `lib/api/mode.ts`
 * が担い、不正値は例外にする（綴り違いで認証チェックが消えないように）。
 */
export default function proxy(request: NextRequest) {
  if (API_MODE !== "http") {
    return NextResponse.next();
  }

  if (!request.cookies.has("dopamin_session")) {
    // 戻り先を `?next=` で運ぶ（ui-screens §1、AC-01-3）。ログイン成功後にここへ戻す。
    const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/domains/:path*",
    "/transfers/:path*",
    "/logs/:path*",
    "/settings/:path*",
  ],
};
