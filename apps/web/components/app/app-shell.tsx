"use client";

import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useCallback, useState } from "react";
import { useMe } from "@/lib/api/hooks";
import { useServices } from "@/lib/api/provider";
import { AiLogPanel } from "./ai-log-panel";
import { Sidebar, type SidebarNavKey } from "./sidebar";

/**
 * Figma: S-10 `80:5548`（Sidebar 190px + main 930px = 1120px 中央寄せ）
 * `(app)` 配下の共通シェル。pathname から Sidebar の Active を決める。
 */

/** 先に書いたものが優先。`/domains/xxx` も「ドメイン取得」を Active にする */
const NAV_PREFIX: readonly (readonly [string, SidebarNavKey])[] = [
  ["/dashboard", "dashboard"],
  ["/domains", "domains"],
  ["/transfers", "transfers"],
  ["/settings", "settings"],
  ["/logs", "logs"],
];

export function activeNavKey(pathname: string): SidebarNavKey {
  const hit = NAV_PREFIX.find(
    ([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return hit?.[1] ?? "dashboard";
}

export interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const services = useServices();
  const me = useMe();
  const [aiLogsOpen, setAiLogsOpen] = useState(false);

  const handleLogout = useCallback(() => {
    // セッションが既に失効していて logout が失敗しても /login へは必ず戻す
    void services.auth
      .logout()
      .catch(() => undefined)
      .finally(() => router.replace("/login"));
  }, [router, services]);

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
