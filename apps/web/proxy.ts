import { type NextRequest, NextResponse } from "next/server";

/**
 * 未認証で保護ページに来たら /login へリダイレクト（AC-01-3, FR-01 spec §8）。
 * ここでは Cookie の有無だけを見る軽いチェックに留め、
 * セッションの有効性検証は API 側の session ミドルウェアが行う。
 */
export default function proxy(request: NextRequest) {
  if (!request.cookies.has("dopamin_session")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/settings/:path*"],
};
