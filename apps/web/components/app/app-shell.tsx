"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useCallback, useState } from "react";
import { endAuthSession } from "@/features/auth/session";
import { useMe } from "@/lib/api/hooks";
import { useServices } from "@/lib/api/provider";
import { AiLogPanel } from "./ai-log-panel";
import { activeNavKey, Sidebar } from "./sidebar";

/**
 * Figma: S-10 `80:5548`（Sidebar 190px + main 930px = 1120px 中央寄せ）
 * `(app)` 配下の共通シェル。pathname から Sidebar の Active を決める。
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

  return (
    <div className="flex flex-1 justify-center">
      <div className="flex w-full max-w-page">
        <Sidebar
          active={activeNavKey(pathname)}
          className="sticky top-0 h-dvh self-start"
          onLogout={handleLogout}
          onOpenAiLogs={openAiLogs}
          userName={me.data?.user.displayName ?? ""}
        />
        <main className="flex min-w-0 flex-1 flex-col gap-3.5 bg-panel px-6 py-5">
          {children}
        </main>
      </div>
      <AiLogPanel onOpenChange={setAiLogsOpen} open={aiLogsOpen} />
    </div>
  );
}
