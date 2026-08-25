"use client";

import { DOPAMIN_NAMESERVERS } from "@dopamin/shared";
import { Check, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * S-43 右パネルと S-44 ダイアログで共通の「ネームサーバー」行。
 * 切替状況のバッジと、切替先のネームサーバ名（`DOPAMIN_NAMESERVERS`）を出す。
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
            ドパ民 DNS に切替済み
          </Badge>
        ) : (
          <Badge icon={<TriangleAlert />} tone="warn">
            未切替 — 反映時に切り替えます
          </Badge>
        )}
      </div>
      <p className="w-full break-all text-caption text-muted">
        {NAMESERVER_NAMES}
      </p>
    </div>
  );
}
