import { LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { TopBar } from "@/components/app/top-bar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * S-80（404 / 403、Figma `80:245`）。
 * `/domains/[name]` の FORBIDDEN / NOT_FOUND もここに落とす（ui-screens §1）。
 *
 * Figma のトップバーは「ログイン」を出しているが、この画面は未ログイン / ログイン済みの
 * 両方から来るため、誤った状態を示さないようアクションは置かない。
 */
export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col">
      <TopBar />
      <div className="flex flex-1 items-center justify-center p-8">
        <EmptyState
          body="URL が間違っているか、ドメインが移管済み / 削除済みの可能性があります。"
          className="max-w-120"
          primary={
            <Button asChild leadingIcon={<LayoutDashboard />} variant="primary">
              <Link href="/dashboard">ダッシュボードへ</Link>
            </Button>
          }
          title="ページが見つかりません"
        />
      </div>
    </div>
  );
}
