import { AppShell } from "@/components/app/app-shell";

/**
 * 認証後の全画面に共通するシェル（Sidebar + main + AI ログパネル）。
 * ルートグループなので URL には現れない（fe-ui 設計 §2）。
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
