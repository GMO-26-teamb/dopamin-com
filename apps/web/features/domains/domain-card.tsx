"use client";

import {
  DISPLAY_STATUS_LABEL,
  isOperationAllowed,
  isRestorable,
} from "@dopamin/shared";
import { ArrowRight, Lock, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useId } from "react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button, type ButtonProps } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import type { DomainSummary } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import {
  daysUntil,
  formatDate,
  formatRelativeTime,
  remainingPercent,
} from "./format";

/**
 * Figma: Domain Card `58:132`（S-10 `80:5548` / S-13 `80:5713`）
 *
 * 保有ドメイン 1 件。Status は ui-screens §2.2 の 8 種で、`deriveDisplayStatus` の結果
 * （+ 有効期限 30 日以内なら Expiring）だけで決まる。EPP ステータスの再解釈はしない。
 */

/** AC-02-2: 残り 30 日以内で Expiring に落とす。 */
export const EXPIRING_THRESHOLD_DAYS = 30;

export type DomainCardStatus =
  | "active"
  | "expiring"
  | "redeemable"
  | "transferring"
  | "hold"
  | "inactive"
  | "pendingDelete"
  | "locked";

/**
 * ui-screens §2.2 の Status 表。`displayStatus`（SSOT）と有効期限だけで決める。
 */
export function deriveCardStatus(
  domain: DomainSummary,
  now: Date,
): DomainCardStatus {
  switch (domain.displayStatus) {
    case "pending_delete":
      return "pendingDelete";
    case "rgp":
      return "redeemable";
    case "transfer_in_pending":
    case "transfer_out_pending":
      return "transferring";
    case "transferred_out":
      // AC-02-4: 保有一覧には出さない（DomainGrid で除外済み）。
      // 万一届いても更新系を触らせない見た目に落としておく。
      return "transferring";
    case "hold":
      return "hold";
    case "inactive":
      return "inactive";
    case "locked":
      return "locked";
    case "active": {
      const remaining =
        domain.expiresAt === null ? null : daysUntil(domain.expiresAt, now);
      return remaining !== null && remaining <= EXPIRING_THRESHOLD_DAYS
        ? "expiring"
        : "active";
    }
  }
}

/** Locked のバッジ文言（ui-screens §2.2「移管ロック / 削除ロック / 更新ロック」）。 */
const LOCK_LABELS: readonly (readonly [RegExp, string])[] = [
  [/(client|server)TransferProhibited$/, "移管ロック"],
  [/(client|server)DeleteProhibited$/, "削除ロック"],
  [/(client|server)RenewProhibited$/, "更新ロック"],
];

function lockLabel(statuses: readonly string[]): string {
  for (const [pattern, label] of LOCK_LABELS) {
    if (statuses.some((status) => pattern.test(status))) {
      return label;
    }
  }
  // UpdateProhibited だけの場合など、3 種に当てはまらないとき
  return DISPLAY_STATUS_LABEL.locked;
}

/** 主操作の種類。`link` 以外は同名のコールバックが無ければ詳細画面へ送る。 */
type ActionKind = "renew" | "restore" | "edit" | "link";

interface PrimaryAction {
  kind: ActionKind;
  label: string;
  variant: NonNullable<ButtonProps["variant"]>;
  /** kind === "link" のときの遷移先 */
  href?: string;
  trailingIcon?: boolean;
}

interface CardPresentation {
  border: string;
  /** Transferring / PendingDelete は全体を 75% に落とす */
  faded: boolean;
  badge: {
    tone: NonNullable<BadgeProps["tone"]>;
    variant: NonNullable<BadgeProps["variant"]>;
    icon?: ReactNode;
    label: string;
  };
  progress: "brand" | "warn" | null;
  /** Meta 右端（有効期限など）。stale のときは「最終同期 n 分前」に差し替わる */
  meta: string;
  primary: PrimaryAction;
  showDetail: boolean;
}

function expiryMeta(domain: DomainSummary, now: Date): string {
  if (domain.expiresAt === null) {
    return "—";
  }
  const remaining = daysUntil(domain.expiresAt, now);
  const date = formatDate(domain.expiresAt);
  return remaining === null ? date : `${date} · 残${remaining}日`;
}

function present(
  domain: DomainSummary,
  status: DomainCardStatus,
  now: Date,
): CardPresentation {
  const detailHref = `/domains/${domain.name}`;
  const rgpRemaining =
    domain.rgpUntil === null ? null : daysUntil(domain.rgpUntil, now);

  switch (status) {
    case "expiring": {
      const remaining =
        domain.expiresAt === null ? null : daysUntil(domain.expiresAt, now);
      return {
        border: "border-warn",
        faded: false,
        badge: {
          tone: "warn",
          variant: "outline",
          icon: <TriangleAlert />,
          label: remaining === null ? "まもなく期限" : `残${remaining}日`,
        },
        progress: "warn",
        // 残日数はバッジ側が持つので、Meta には期限日だけを出す（Figma S-10）
        meta: domain.expiresAt === null ? "—" : formatDate(domain.expiresAt),
        primary: { kind: "renew", label: "今すぐ更新", variant: "solid" },
        showDetail: true,
      };
    }
    case "redeemable":
      return {
        border: "border-line",
        faded: false,
        badge: {
          tone: "warn",
          variant: "outline",
          label:
            rgpRemaining === null ? "復旧猶予" : `復旧猶予 残${rgpRemaining}日`,
        },
        progress: null,
        meta: "廃止済み — 復旧可能",
        primary: { kind: "restore", label: "復旧する", variant: "solid" },
        showDetail: true,
      };
    case "transferring":
      return {
        border: "border-soft",
        faded: true,
        badge: { tone: "muted", variant: "outline", label: "移管申請中" },
        progress: null,
        meta: "完了までロック中",
        primary: {
          kind: "link",
          label: "状態を確認",
          variant: "subtle",
          href: `/transfers?domain=${encodeURIComponent(domain.name)}`,
          trailingIcon: true,
        },
        showDetail: false,
      };
    case "hold":
      return {
        border: "border-warn",
        faded: false,
        badge: {
          tone: "warn",
          variant: "outline",
          icon: <TriangleAlert />,
          label: DISPLAY_STATUS_LABEL.hold,
        },
        progress: null,
        meta: expiryMeta(domain, now),
        primary: { kind: "edit", label: "情報修正", variant: "outline" },
        showDetail: true,
      };
    case "inactive":
      return {
        border: "border-line",
        faded: false,
        badge: {
          tone: "neutral",
          variant: "outline",
          label: DISPLAY_STATUS_LABEL.inactive,
        },
        progress: "brand",
        meta: expiryMeta(domain, now),
        primary: { kind: "edit", label: "NS を設定", variant: "solid" },
        showDetail: true,
      };
    case "pendingDelete":
      return {
        border: "border-soft",
        faded: true,
        badge: {
          tone: "muted",
          variant: "solid",
          label: DISPLAY_STATUS_LABEL.pending_delete,
        },
        progress: null,
        meta:
          rgpRemaining === null
            ? "完全削除の手続き中"
            : `完全削除まで 残${rgpRemaining}日`,
        primary: {
          kind: "link",
          label: "詳細",
          variant: "subtle",
          href: detailHref,
          trailingIcon: true,
        },
        showDetail: false,
      };
    case "locked":
      return {
        border: "border-line",
        faded: false,
        badge: {
          tone: "neutral",
          variant: "outline",
          icon: <Lock />,
          label: lockLabel(domain.statuses),
        },
        progress: "brand",
        meta: expiryMeta(domain, now),
        primary: { kind: "renew", label: "更新", variant: "outline" },
        showDetail: true,
      };
    case "active":
      return {
        border: "border-line",
        faded: false,
        badge: {
          tone: "ok",
          variant: "outline",
          label: DISPLAY_STATUS_LABEL.active,
        },
        progress: "brand",
        meta: expiryMeta(domain, now),
        primary: { kind: "renew", label: "更新", variant: "outline" },
        showDetail: true,
      };
  }
}

/** S-13: 同期に失敗したカードは更新系を Disabled にする。 */
const STALE_REASON =
  "同期に失敗しています。「最新化」で最新の状態にしてから操作してください。";

/**
 * 主操作を実行できない理由（AC-07-1）。null なら実行できる。
 * 参照系（詳細 / 状態を確認）は stale でも塞がない。
 */
function blockedReason(domain: DomainSummary, kind: ActionKind): string | null {
  if (kind === "link") {
    return null;
  }
  if (domain.stale) {
    return STALE_REASON;
  }
  if (kind === "restore") {
    return isRestorable(domain.rgpStatuses, domain.statuses)
      ? null
      : "復旧できる状態ではありません。";
  }
  const operation = kind === "renew" ? "renew" : "update";
  const check = isOperationAllowed(operation, domain.statuses);
  return check.allowed
    ? null
    : `${check.blockedBy.join(" / ")} のため実行できません。`;
}

export interface DomainCardProps {
  domain: DomainSummary;
  /** 残日数・相対時刻の基準（既定は現在時刻。テストで固定する） */
  now?: Date;
  /** D-01 更新。未指定なら詳細画面へ遷移する（詳細画面がダイアログを持つ） */
  onRenew?: (domain: DomainSummary) => void;
  /** D-04 復旧。未指定なら詳細画面へ遷移する */
  onRestore?: (domain: DomainSummary) => void;
  /** D-02 情報修正 / NS 設定。未指定なら詳細画面へ遷移する */
  onEdit?: (domain: DomainSummary) => void;
  className?: string;
}

export function DomainCard({
  domain,
  now = new Date(),
  onRenew,
  onRestore,
  onEdit,
  className,
}: DomainCardProps) {
  const titleId = useId();
  const reasonId = useId();
  const status = deriveCardStatus(domain, now);
  const view = present(domain, status, now);
  const detailHref = `/domains/${domain.name}`;

  const handlers: Record<
    Exclude<ActionKind, "link">,
    ((domain: DomainSummary) => void) | undefined
  > = { renew: onRenew, restore: onRestore, edit: onEdit };
  const onPrimary =
    view.primary.kind === "link" ? undefined : handlers[view.primary.kind];
  const reason = blockedReason(domain, view.primary.kind);
  const trailingIcon = view.primary.trailingIcon ? <ArrowRight /> : undefined;

  // 実行できないときは常に Disabled（S-13 / AC-07-1）。
  // 実行できるならコールバック優先で、無ければ詳細画面へ送る（ダイアログは詳細画面が持つ）。
  let primaryButton: ReactNode;
  if (reason !== null) {
    primaryButton = (
      <Button
        aria-describedby={reasonId}
        disabled
        size="sm"
        variant={view.primary.variant}
      >
        {view.primary.label}
      </Button>
    );
  } else if (onPrimary === undefined) {
    primaryButton = (
      <Button
        asChild
        size="sm"
        variant={view.primary.variant}
        {...(trailingIcon ? { trailingIcon } : {})}
      >
        <Link href={view.primary.href ?? detailHref}>{view.primary.label}</Link>
      </Button>
    );
  } else {
    primaryButton = (
      <Button
        onClick={() => onPrimary(domain)}
        size="sm"
        variant={view.primary.variant}
      >
        {view.primary.label}
      </Button>
    );
  }

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        "flex w-full flex-col gap-2 border-2 border-solid bg-panel px-4 py-3",
        view.border,
        view.faded && "opacity-[var(--opacity-muted)]",
        className,
      )}
    >
      <div className="flex w-full items-center justify-between gap-2 overflow-hidden">
        <p className="min-w-0 truncate text-domain-card text-ink" id={titleId}>
          {domain.name}
        </p>
        <Badge
          tone={view.badge.tone}
          variant={view.badge.variant}
          {...(view.badge.icon ? { icon: view.badge.icon } : {})}
        >
          {view.badge.label}
        </Badge>
      </div>

      {view.progress === null ? null : (
        <ProgressBar
          aria-label={`${domain.name} の有効期限`}
          tone={view.progress}
          value={remainingPercent(domain.registeredAt, domain.expiresAt, now)}
        />
      )}

      <div className="flex w-full items-center justify-between gap-2 overflow-hidden text-caption text-muted">
        <span className="shrink-0">{domain.registry}</span>
        <span className="flex min-w-0 items-center gap-1.5">
          {domain.stale ? <Badge tone="muted">Stale</Badge> : null}
          <span className="truncate">
            {domain.stale
              ? `最終同期 ${formatRelativeTime(domain.syncedAt, now)}`
              : view.meta}
          </span>
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        {primaryButton}
        {view.showDetail ? (
          <Button
            asChild
            size="sm"
            trailingIcon={<ArrowRight />}
            variant="subtle"
          >
            <Link href={detailHref}>詳細</Link>
          </Button>
        ) : null}
        {reason === null ? null : (
          <span className="sr-only" id={reasonId}>
            {reason}
          </span>
        )}
      </div>
    </article>
  );
}
