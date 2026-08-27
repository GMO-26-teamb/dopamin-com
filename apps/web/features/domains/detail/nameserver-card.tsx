"use client";

import { isDopaminNameservers } from "@dopamin/shared";
import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { DomainDetail } from "@/lib/api/types";

/**
 * Figma: S-30 ネームサーバーカード（`83:2456`）
 * 各行は等幅。未設定は「—（未設定）」（S-38）。
 *
 * 編集はカードに 1 つ。NS は全量を差し替える操作（D-02 は行単位で開かない）なので、
 * 行ごとに同じダイアログを開くボタンを並べても選択肢が増えたようにしか見えない。
 */
export interface NameserverCardProps {
  domain: DomainDetail;
  onEdit: () => void;
  /** S-31 / S-34 / S-36 では編集させない。 */
  editable: boolean;
}

export function NameserverCard({
  domain,
  onEdit,
  editable,
}: NameserverCardProps) {
  const usesDopamin = isDopaminNameservers(domain.nameservers);

  return (
    <Card kicker="ネームサーバー">
      {domain.nameservers.length === 0 ? (
        <p className="w-full text-body-sm text-muted">—（未設定）</p>
      ) : (
        domain.nameservers.map((nameserver) => (
          <p
            className="w-full truncate text-code-input text-ink"
            key={nameserver}
          >
            {nameserver}
          </p>
        ))
      )}
      {!usesDopamin && !editable ? null : (
        <div className="flex w-full items-center justify-between gap-2 pt-0.5">
          {usesDopamin ? (
            <Badge tone="brand">ドパ民 DNS</Badge>
          ) : (
            <span aria-hidden="true" />
          )}
          {editable ? (
            <Button
              aria-label="ネームサーバーの情報修正"
              leadingIcon={<Pencil />}
              onClick={onEdit}
              size="sm"
              variant="subtle"
            >
              情報修正
            </Button>
          ) : null}
        </div>
      )}
    </Card>
  );
}
