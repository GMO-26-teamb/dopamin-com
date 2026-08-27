"use client";

/**
 * Figma: S-50 `85:5523` のセクション（受信した申請 / 申請中 / 履歴）。
 *
 * `Transfer[]` を Kind ごとに 3 つのセクションに分ける。0 件のセクションは出さない
 * （全部 0 件なら呼び出し側が S-51 の Empty State を出す）。
 */

import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { Transfer } from "@/lib/api/types";
import { TransferItem, transferKind } from "./transfer-item";

/** 「受信 n · 申請中 m · 履歴 k」用の内訳（Page Header の Meta にも使う）。 */
export interface TransferGroups {
  received: Transfer[];
  pending: Transfer[];
  history: Transfer[];
}

export function groupTransfers(transfers: Transfer[]): TransferGroups {
  const groups: TransferGroups = { received: [], pending: [], history: [] };
  for (const transfer of transfers) {
    const kind = transferKind(transfer);
    if (kind === "out-received") {
      groups.received.push(transfer);
    } else if (kind === "history") {
      groups.history.push(transfer);
    } else {
      // in-pending と import-pending は同じ「申請中（移管 IN）」に並べる
      groups.pending.push(transfer);
    }
  }
  return groups;
}

interface SectionProps {
  id: string;
  title: string;
  items: Transfer[];
  children: (transfer: Transfer) => ReactNode;
}

function Section({ id, title, items, children }: SectionProps) {
  if (items.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby={id} className="flex w-full flex-col gap-2">
      <h2 className="text-overline text-muted" id={id}>
        {title}
      </h2>
      {items.map((transfer) => children(transfer))}
    </section>
  );
}

export interface TransferSectionsProps {
  transfers: Transfer[];
  /** いずれかの操作が実行中。行のボタンをすべて止める（二重送信防止） */
  busy?: boolean;
  /** S-53（更新エラー）。承認 / 拒否 / 取消だけを止め、再照会の導線は残す */
  updateFailed?: boolean;
  /** 「最新化」/「再試行」実行中の transfer id */
  recheckingId?: string | null;
  onApprove: (transfer: Transfer) => void;
  onReject: (transfer: Transfer) => void;
  onCancel: (transfer: Transfer) => void;
  onRecheck: (transfer: Transfer) => void;
}

export function TransferSections({
  transfers,
  busy = false,
  updateFailed = false,
  recheckingId = null,
  onApprove,
  onReject,
  onCancel,
  onRecheck,
}: TransferSectionsProps) {
  const groups = groupTransfers(transfers);

  const row = (transfer: Transfer) => (
    <TransferItem
      busy={busy}
      key={transfer.id}
      onApprove={onApprove}
      onCancel={onCancel}
      onRecheck={onRecheck}
      onReject={onReject}
      recheckPending={recheckingId === transfer.id}
      transfer={transfer}
      updateFailed={updateFailed}
    />
  );

  return (
    <div className="flex w-full flex-col gap-3.5">
      <Section
        id="transfers-received"
        items={groups.received}
        title="受信した申請（移管 OUT）"
      >
        {row}
      </Section>
      <Section
        id="transfers-pending"
        items={groups.pending}
        title="申請中（移管 IN）"
      >
        {row}
      </Section>
      <Section id="transfers-history" items={groups.history} title="履歴">
        {row}
      </Section>
    </div>
  );
}

/** 読み込み中（S-50 の初回取得）。形は Transfer Item に合わせる。 */
export function TransferSectionsSkeleton() {
  return (
    <div
      aria-label="読み込み中"
      className="flex w-full flex-col gap-2"
      role="status"
    >
      <Skeleton className="h-3.5 w-40" />
      <Skeleton className="h-15" shape="block" />
      <Skeleton className="mt-2 h-3.5 w-40" />
      <Skeleton className="h-15" shape="block" />
    </div>
  );
}
