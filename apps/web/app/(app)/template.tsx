import { PageTransition } from "@/components/app/page-transition";

/**
 * `(app)` 配下の画面遷移アニメーション。layout と違い template はナビゲーションごとに
 * 再マウントされるので、ページの中身だけがフェードインする（Sidebar は動かない）。
 */
export default function AppTemplate({ children }: LayoutProps<"/">) {
  return <PageTransition>{children}</PageTransition>;
}
