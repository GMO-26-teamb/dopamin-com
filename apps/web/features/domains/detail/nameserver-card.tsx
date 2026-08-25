"use client";

import { isDopaminNameservers } from "@dopamin/shared";
import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import type { DomainDetail } from "@/lib/api/types";

/**
 * Figma: S-30 ネームサーバーカード（`83:2456`）
 * 各行は等幅 + 右端に鉛筆アイコン（D-02 を開く）。未設定は「—（未設定）」（S-38）。
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
          <div
            className="flex w-full items-center justify-between gap-2"
            key={nameserver}
          >
            <span className="min-w-0 truncate text-code-input text-ink">
              {nameserver}
            </span>
            {editable ? (
              <IconButton
                aria-label={`${nameserver} を変更`}
                icon={<Pencil />}
                onClick={onEdit}
                size="sm"
                variant="subtle"
              />
            ) : null}
          </div>
        ))
      )}
      {usesDopamin ? (
        <div className="flex w-full items-center pt-0.5">
          <Badge tone="brand">ドパ民 DNS</Badge>
        </div>
      ) : null}
    </Card>
  );
}
