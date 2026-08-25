"use client";

import { useMe } from "@/lib/api/hooks";

/**
 * ダッシュボードの仮画面（FR-01 の動作確認用）。
 * 保有ドメイン一覧（S-10〜S-13 / FR-02）の実装時に置き換える。
 *
 * 認証チェックは `proxy.ts`（http モードで Cookie が無ければ `/login?next=` へ）と
 * API 側の session ミドルウェアに任せる。ここで `fetchMe()` を直接叩いて
 * リダイレクトすると、モックモードでは実 API が無いため必ず失敗して
 * `/login` ⇄ `/dashboard` のループになる。
 */
export default function DashboardPage() {
  const me = useMe();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3.5 p-8">
      <h1 className="text-heading-page text-ink">
        {me.data === undefined
          ? "読み込み中…"
          : `ようこそ、${me.data.user.displayName} さん`}
      </h1>
      <p className="text-body-sm text-muted">
        （ここに保有ドメイン一覧が入ります: FR-02）
      </p>
    </div>
  );
}
