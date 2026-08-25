"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useCallback, useState } from "react";
import { endAuthSession } from "@/features/auth/session";
import { useMe } from "@/lib/api/hooks";
import { useServices } from "@/lib/api/provider";
import { AiLogPanel } from "./ai-log-panel";
import { MobileNav } from "./mobile-nav";
import { activeNavKey, Sidebar } from "./sidebar";

/**
 * Figma: S-10 `80:5548`（Sidebar + main を `--size-page` 幅で中央寄せ）
 * `(app)` 配下の共通シェル。pathname から Sidebar の Active を決める。
 * md 未満ではサイドバーの代わりに MobileNav（横ナビ）を上に出す。
 */

export interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const services = useServices();
  const queryClient = useQueryClient();
  const me = useMe();
  const [aiLogsOpen, setAiLogsOpen] = useState(false);

  const handleLogout = useCallback(() => {
    // セッションが既に失効していて logout が失敗しても /login へは必ず戻す。
    // 同じタブで別ユーザーがログインしたときに前のユーザーのキャッシュが
    // 見えないよう、離脱前に必ずキャッシュを捨てる。
    void services.auth
      .logout()
      .catch(() => undefined)
      .finally(() => {
        // モードによらずログイン済みの目印も落とす（features/auth/session.ts）。
        // 残っていると /login が「ログイン済み」と判断して /dashboard へ戻してしまう。
        endAuthSession();
        queryClient.clear();
        router.replace("/login");
      });
  }, [queryClient, router, services]);

  const openAiLogs = useCallback(() => setAiLogsOpen(true), []);

  const active = activeNavKey(pathname);

  return (
    <div className="flex flex-1 justify-center">
      <div className="flex w-full max-w-page flex-col md:flex-row">
        <MobileNav
          {...(active === undefined ? {} : { active })}
          className="md:hidden"
          onLogout={handleLogout}
          onOpenAiLogs={openAiLogs}
        />
        <Sidebar
          {...(active === undefined ? {} : { active })}
          className="sticky top-0 hidden h-dvh self-start md:flex"
          onLogout={handleLogout}
          onOpenAiLogs={openAiLogs}
          userName={me.data?.user.displayName ?? ""}
        />
        <main className="flex min-w-0 flex-1 flex-col gap-4 bg-panel px-4 py-5 md:px-8 md:py-7 xl:px-10 xl:py-8">
          {children}
        </main>
      </div>
      <AiLogPanel onOpenChange={setAiLogsOpen} open={aiLogsOpen} />
    </div>
  );
}
