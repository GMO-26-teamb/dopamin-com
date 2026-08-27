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
import { REGISTRY_LABEL } from "./registry-label";
import { statusBadgeTone, statusBadgeVariant } from "./status-badge";

/**
 * Figma: Domain Card `58:132`（S-10 `80:5548` / S-13 `80:5713`）
 *
 * 保有ドメイン 1 件。Status は ui-screens §2.2 の 8 種で、`deriveDisplayStatus` の結果
 * （+ 有効期限 30 日以内なら Expiring）だけで決まる。EPP ステータスの再解釈はしない。
 *
 * カード面そのものが詳細画面へのリンク（stretched link）で、操作ボタンは主操作 1 つだけ。
 * 同じ事実を何度も言わないよう、バッジは状態名・Meta は「いつまで / 次に何ができるか」に
 * 役割を分けている（#216）。
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
  badge: {
    tone: NonNullable<BadgeProps["tone"]>;
    variant: NonNullable<BadgeProps["variant"]>;
    icon?: ReactNode;
    label: string;
  };
  progress: "brand" | "warn" | null;
  /** Meta 右端（有効期限など）。stale のときは「最終同期 n 分前」に差し替わる */
  meta: string;
  /** 主操作。詳細を開くだけで足りる状態（PendingDelete）は null にしてボタンを出さない。 */
  primary: PrimaryAction | null;
}

/**
 * 「2027-07-23 · 残330日」。
 * 残日数はバッジではなく Meta のこの 1 箇所だけに出す（バッジは状態名だけ・#216）。
 */
function expiryMeta(domain: DomainSummary, now: Date): string {
  if (domain.expiresAt === null) {
    return "—";
  }
  const remaining = daysUntil(domain.expiresAt, now);
  const date = formatDate(domain.expiresAt);
  return remaining === null ? date : `${date} · 残${remaining}日`;
}

/** 「つながりません · 2027-07-23」。状態の意味を先に、有効期限を後ろに置く。 */
function stateMeta(text: string, expiresAt: string | null): string {
  return expiresAt === null ? text : `${text} · ${formatDate(expiresAt)}`;
}

function present(
  domain: DomainSummary,
  status: DomainCardStatus,
  now: Date,
): CardPresentation {
  const rgpRemaining =
    domain.rgpUntil === null ? null : daysUntil(domain.rgpUntil, now);
  // Tone / Variant は ui-screens §2.2 の表（`./status-badge`）が SSOT。
  // Expiring だけは `displayStatus` に無い派生状態なので Warn を直接指定する。
  const badgeStyle = {
    tone: statusBadgeTone(domain.displayStatus),
    variant: statusBadgeVariant(domain.displayStatus),
  } as const;

  switch (status) {
    case "expiring":
      return {
        border: "border-warn",
        badge: {
          tone: "warn",
          variant: "outline",
          icon: <TriangleAlert />,
          label: "まもなく期限",
        },
        progress: "warn",
        meta: expiryMeta(domain, now),
        primary: { kind: "renew", label: "今すぐ更新", variant: "solid" },
      };
    case "redeemable":
      return {
        border: "border-line",
        badge: { ...badgeStyle, label: DISPLAY_STATUS_LABEL.rgp },
        progress: null,
        meta:
          rgpRemaining === null
            ? "いまなら復旧できます"
            : `復旧できます · 残${rgpRemaining}日`,
        primary: { kind: "restore", label: "復旧する", variant: "solid" },
      };
    case "transferring":
      return {
        border: "border-soft",
        badge: { ...badgeStyle, label: "移管申請中" },
        progress: null,
        meta: "完了するまで変更できません",
        primary: {
          kind: "link",
          label: "状態を確認",
          variant: "subtle",
          href: `/transfers?domain=${encodeURIComponent(domain.name)}`,
          trailingIcon: true,
        },
      };
    case "hold":
      return {
        border: "border-warn",
        badge: {
          ...badgeStyle,
          icon: <TriangleAlert />,
          label: DISPLAY_STATUS_LABEL.hold,
        },
        progress: null,
        meta: expiryMeta(domain, now),
        primary: { kind: "edit", label: "情報修正", variant: "outline" },
      };
    case "inactive":
      return {
        border: "border-line",
        badge: {
          ...badgeStyle,
          label: DISPLAY_STATUS_LABEL.inactive,
        },
        progress: "brand",
        meta: stateMeta("つながりません", domain.expiresAt),
        primary: { kind: "edit", label: "NS を設定", variant: "solid" },
      };
    case "pendingDelete":
      return {
        border: "border-soft",
        badge: {
          ...badgeStyle,
          label: DISPLAY_STATUS_LABEL.pending_delete,
        },
        progress: null,
        meta:
          rgpRemaining === null
            ? "完全削除の手続き中"
            : `完全削除まで · 残${rgpRemaining}日`,
        // できる操作が無い状態。詳細はカード面を押せば開くのでボタンは出さない
        primary: null,
      };
    case "locked":
      return {
        border: "border-line",
        badge: {
          ...badgeStyle,
          icon: <Lock />,
          label: lockLabel(domain.statuses),
        },
        progress: "brand",
        meta: expiryMeta(domain, now),
        primary: { kind: "renew", label: "更新", variant: "outline" },
      };
    case "active":
      return {
        border: "border-line",
        badge: {
          ...badgeStyle,
          label: DISPLAY_STATUS_LABEL.active,
        },
        progress: "brand",
        meta: expiryMeta(domain, now),
        primary: { kind: "renew", label: "更新", variant: "outline" },
      };
  }
}

/** S-13: 同期に失敗したカードは更新系を Disabled にする。 */
const STALE_REASON = "「最新化」を押すと操作できます。";

/**
 * 主操作を実行できない理由（AC-07-1）。null なら実行できる。
 *
 * カードに見える形で出す文なので、EPP ステータス名をそのまま並べず
 * 「次に何をすれば動くか」だけを書く。詳細を開く導線（カード面 / 状態を確認）は塞がない。
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
      : "復旧できる期間を過ぎています。";
  }
  const operation = kind === "renew" ? "renew" : "update";
  const check = isOperationAllowed(operation, domain.statuses);
  if (check.allowed) {
    return null;
  }
  // client* のロックは自分で外せる。server* や手続き中はレジストリ側の都合。
  const selfUnlockable =
    check.blockedBy.length > 0 &&
    check.blockedBy.every((status) => status.startsWith("client"));
  return selfUnlockable
    ? "詳細画面でロックを外すと操作できます。"
    : "レジストリ側で止まっているため操作できません。";
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
  const detailId = useId();
  const reasonId = useId();
  const status = deriveCardStatus(domain, now);
  const view = present(domain, status, now);
  const detailHref = `/domains/${encodeURIComponent(domain.name)}`;
  const primary = view.primary;

  const handlers: Record<
    Exclude<ActionKind, "link">,
    ((domain: DomainSummary) => void) | undefined
  > = { renew: onRenew, restore: onRestore, edit: onEdit };
  const onPrimary =
    primary === null || primary.kind === "link"
      ? undefined
      : handlers[primary.kind];
  const reason = primary === null ? null : blockedReason(domain, primary.kind);

  // 実行できないときは常に Disabled（S-13 / AC-07-1）。
  // 実行できるならコールバック優先で、無ければ詳細画面へ送る（ダイアログは詳細画面が持つ）。
  let primaryButton: ReactNode = null;
  if (primary === null) {
    primaryButton = null;
  } else if (reason !== null) {
    primaryButton = (
      <Button
        aria-describedby={reasonId}
        disabled
        size="sm"
        variant={primary.variant}
      >
        {primary.label}
      </Button>
    );
  } else if (onPrimary === undefined) {
    primaryButton = (
      <Button
        asChild
        size="sm"
        variant={primary.variant}
        {...(primary.trailingIcon ? { trailingIcon: <ArrowRight /> } : {})}
      >
        <Link href={primary.href ?? detailHref}>{primary.label}</Link>
      </Button>
    );
  } else {
    primaryButton = (
      <Button
        onClick={() => onPrimary(domain)}
        size="sm"
        variant={primary.variant}
      >
        {primary.label}
      </Button>
    );
  }

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        "group relative flex w-full flex-col gap-2 border-2 border-solid bg-panel px-4 py-3 transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_6px_0_-2px_var(--color-line)] motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        // 控えめに見せたい状態（移管中 / 削除待ち）は枠を soft にするだけにする。
        // 全体の不透明度を下げると本文のコントラストが 4.5:1 を割るため（#95）
        view.border,
        className,
      )}
    >
      {/*
        カード面のどこを押しても詳細へ（stretched link）。
        絶対配置なので Tab の順番は「カード → 主操作」のままで、フォーカスリング
        （globals.css の :focus-visible）はカードの外周にそのまま出る。
        主操作は下の relative なブロックが前面に来るので、クリックを奪われない。
      */}
      <Link
        aria-labelledby={`${titleId} ${detailId}`}
        className="absolute inset-0"
        href={detailHref}
      />
      <span className="sr-only" id={detailId}>
        の詳細
      </span>

      <div className="flex w-full items-center justify-between gap-2 overflow-hidden">
        <p
          className="min-w-0 truncate text-domain-card text-ink group-hover:underline group-hover:underline-offset-2"
          id={titleId}
        >
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
        <span className="shrink-0">{REGISTRY_LABEL[domain.registry]}</span>
        <span className="flex min-w-0 items-center gap-1.5">
          {domain.stale ? <Badge tone="muted">未同期</Badge> : null}
          <span className="truncate">
            {domain.stale
              ? `最終同期 ${formatRelativeTime(domain.syncedAt, now)}`
              : view.meta}
          </span>
        </span>
      </div>

      {primary === null ? null : (
        <div className="relative flex flex-col items-start gap-1">
          {primaryButton}
          {reason === null ? null : (
            // Disabled の理由は目にも見せる（読み上げは aria-describedby が拾う）
            <p className="text-caption text-muted" id={reasonId}>
              {reason}
            </p>
          )}
        </div>
      )}
    </article>
  );
}
