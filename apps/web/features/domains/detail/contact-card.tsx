"use client";

import { Badge } from "@/components/ui/badge";
import { Card, KeyValueRow } from "@/components/ui/card";
import type { DomainDetail } from "@/lib/api/types";

/**
 * Figma: S-30 コンタクトカード（`83:2476`）
 * 登録者（ダミー PII）。移管 IN 後に差し替えできていない場合は「未移行」バッジ（S-39）。
 */
export interface ContactCardProps {
  domain: DomainDetail;
}

export function ContactCard({ domain }: ContactCardProps) {
  return (
    <Card
      emphasis={domain.registrant.migrated ? "default" : "warn"}
      kicker="コンタクト（ダミーPII）"
    >
      <KeyValueRow label="登録者" value={domain.registrant.name} />
      <KeyValueRow label="メール" value={domain.registrant.email} />
      {domain.registrant.migrated ? null : (
        <div className="flex w-full items-center pt-0.5">
          <Badge tone="warn">未移行</Badge>
        </div>
      )}
    </Card>
  );
}
