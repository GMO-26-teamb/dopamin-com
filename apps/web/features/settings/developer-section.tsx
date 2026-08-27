import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * 設定の末尾に置く開発者向けのまとまり（#215）。
 * ログはナビから外したので、ここが `/logs` への唯一の入口になる。
 */
export interface DeveloperSectionProps {
  className?: string;
}

export function DeveloperSection({ className }: DeveloperSectionProps) {
  return (
    <Card className={className} kicker="開発者向け">
      <div className="flex w-full items-center justify-between gap-2">
        <p className="min-w-0 text-caption text-muted">
          レジストリ通信と AI 呼び出しの記録
        </p>
        <Button
          asChild
          size="sm"
          trailingIcon={<ArrowRight />}
          variant="outline"
        >
          <Link href="/logs">ログを開く</Link>
        </Button>
      </div>
    </Card>
  );
}
