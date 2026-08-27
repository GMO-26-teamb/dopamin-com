"use client";

import { DOPAMIN_NAMESERVERS } from "@dopamin/shared";
import { Check, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * S-43 反映セクションの「ネームサーバー」行。
 * バッジは状態名だけにして、切替先や予告は下の 1 文で伝える（バッジに文を入れない）。
 * 名前はハードコードせず `@dopamin/shared` の定数を唯一の出どころにする。
 */

const NAMESERVER_NAMES = DOPAMIN_NAMESERVERS.join(" / ");

export interface NameserverBadgeProps {
  switched: boolean;
}

export function NameserverBadge({ switched }: NameserverBadgeProps) {
  return (
    <div className="flex w-full flex-col gap-1">
      <div className="flex w-full items-center justify-between gap-2 text-body-sm">
        <span className="shrink-0 text-muted">ネームサーバー</span>
        {switched ? (
          <Badge icon={<Check />} tone="ok">
            切替済み
          </Badge>
        ) : (
          <Badge icon={<TriangleAlert />} tone="warn">
            未切替
          </Badge>
        )}
      </div>
      <p className="w-full break-all text-caption text-muted">
        {switched
          ? NAMESERVER_NAMES
          : `反映時に ${NAMESERVER_NAMES} に切り替えます`}
      </p>
    </div>
  );
}
