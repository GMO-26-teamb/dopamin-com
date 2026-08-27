"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { DomainDetail } from "@/lib/api/types";

/**
 * Figma: S-30 サブドメイン設計カード（`83:2478`、Emphasis = Brand）
 * 設計あり → 「保存済み · n ホスト · 反映済み a/n」+「開く」（S-43）。
 * 未作成 → 「未作成」+「設計をはじめる」（S-40）。
 *
 * 画面で一番目立つカードなので、カード面のどこを押しても S-43 へ入れるようにする
 * （リンクの疑似要素をカード全面に広げる stretched link。リンクは 1 つのままなので
 * 読み上げも変わらず、フォーカスリングはリンク自身に出る）。
 */
export interface SubdomainCardProps {
  domain: DomainDetail;
  /** 移管済み（S-34）/ 削除待ち（S-36）は表示のみで導線を出さない。 */
  readOnly?: boolean;
}

export function SubdomainCard({
  domain,
  readOnly = false,
}: SubdomainCardProps) {
  const plan = domain.subdomainPlan;
  const href = `/domains/${encodeURIComponent(domain.name)}/subdomains`;

  return (
    <Card className="relative" emphasis="brand" kicker="サブドメイン設計">
      <div className="flex w-full items-center justify-between gap-2">
        <p className="min-w-0 text-body-sm text-ink">
          {plan === null
            ? "未作成"
            : `保存済み · ${plan.hosts}ホスト · 反映済み ${plan.applied}/${plan.hosts}`}
        </p>
        {readOnly ? null : (
          <Button
            asChild
            className="after:absolute after:inset-0"
            size="sm"
            trailingIcon={<ArrowRight />}
            variant="subtle"
          >
            <Link href={href}>{plan === null ? "設計をはじめる" : "開く"}</Link>
          </Button>
        )}
      </div>
    </Card>
  );
}
