import { type NextRequest, NextResponse } from "next/server";

/**
 * 未認証で保護ページに来たら /login へリダイレクト（AC-01-3, FR-01 spec §8）。
 * ここでは Cookie の有無だけを見る軽いチェックに留め、
 * セッションの有効性検証は API 側の session ミドルウェアが行う。
 *
 * NEXT_PUBLIC_API_MODE が "http" 以外（既定のモック）のときは素通しする。
 * モックだけで全画面・全状態をレビューできるようにするため（fe-ui 設計 §1）。
 */
export default function proxy(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_API_MODE !== "http") {
    return NextResponse.next();
  }

  if (!request.cookies.has("dopamin_session")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
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
