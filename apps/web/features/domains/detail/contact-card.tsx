"use client";

import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, KeyValueRow } from "@/components/ui/card";
import type { DomainDetail } from "@/lib/api/types";

/**
 * Figma: S-30 コンタクトカード（`83:2476`）
 * 登録者（ダミー PII）。移管 IN 後に差し替えできていない場合は「未移行」バッジ（S-39）。
 *
 * 未移行はここと状態バナーの 2 か所に出る。バナーは「いま何が起きているか」、
 * ここは「どの値が古いか」を示すので役割が違う。カード枠まで警告色にすると
 * 3 つ目の同じ合図になるだけなので、枠は既定のままにする。
 * 直し方（D-02）はバナーを探しに戻らなくていいよう、このカードにも置く。
 */
export interface ContactCardProps {
  domain: DomainDetail;
  /** D-02 を開く。表示のみの状態（S-31 / S-34 / S-36）では渡さない。 */
  onEdit?: () => void;
}

/**
 * レジストリの `info` は登録者をコンタクト ID でしか返さないので、アプリが
 * そのコンタクトを持っていないと中身が分からない（API の `registrantProfile` が null）。
 * ID を氏名として出しても読めないため、空のまま「未設定」と書く。
 */
function contactValue(value: string): string {
  return value.length === 0 ? "未設定" : value;
}

export function ContactCard({ domain, onEdit }: ContactCardProps) {
  return (
    <Card kicker="コンタクト">
      <KeyValueRow
        label="登録者"
        value={contactValue(domain.registrant.name)}
      />
      <KeyValueRow
        label="メール"
        value={contactValue(domain.registrant.email)}
      />
      {domain.registrant.migrated && onEdit === undefined ? null : (
        <div className="flex w-full items-center justify-between gap-2 pt-0.5">
          {domain.registrant.migrated ? (
            <span aria-hidden="true" />
          ) : (
            <Badge tone="warn">未移行</Badge>
          )}
          {onEdit === undefined ? null : (
            <Button
              aria-label="登録者の情報修正"
              leadingIcon={<Pencil />}
              onClick={onEdit}
              size="sm"
              variant="subtle"
            >
              情報修正
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
