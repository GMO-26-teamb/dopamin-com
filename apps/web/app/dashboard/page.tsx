"use client";

import type { AuthUser } from "@dopamin/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchMe, logout } from "@/lib/webauthn";

/**
 * ダッシュボードの仮画面（FR-01 の動作確認用）。
 * 保有ドメイン一覧（FR-02）の実装時にフロント担当が置き換える想定。
 */
export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    void fetchMe().then((me) => {
      if (me) {
        setUser(me);
      } else {
        router.replace("/login");
      }
    });
  }, [router]);

  const onLogout = async () => {
    await logout();
    router.replace("/login");
  };

  if (!user) {
    return (
      <main className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">読み込み中…</p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="font-semibold text-2xl">
        ようこそ、{user.displayName} さん
      </h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        （ここに保有ドメイン一覧が入ります: FR-02）
      </p>
      <div className="flex gap-4 text-sm">
        <Link href="/settings/passkeys" className="underline">
          パスキー管理
        </Link>
        <button type="button" onClick={onLogout} className="underline">
          ログアウト
        </button>
      </div>
    </main>
  );
}
