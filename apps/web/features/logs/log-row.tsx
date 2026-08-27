"use client";

import { Check, ChevronDown, TriangleAlert } from "lucide-react";
import { type ReactNode, useId } from "react";
import { Badge } from "@/components/ui/badge";
import { CodeBlock } from "@/components/ui/code-block";
import { cn } from "@/lib/utils";

/**
 * Figma: Log Row `77:85` / Log Detail `77:90`（S-60 / S-61）
 *
 * 操作ログ・AI ログで共通の 1 行。列は Figma と同じ
 * 日時 110 / コマンド 160 / レジストリ（プロバイダ）150 / 対象 fill / 結果 110 /
 * レイテンシ 70 + 展開シェブロン 16。行全体がボタン（disclosure）で、
 * 展開すると下に Log Detail が開く（ui-screens §2.7）。
 */

/**
 * 日時は JST 固定で整形する。サーバー / クライアントのタイムゾーンに依らず
 * 同じ文字列になるので、ハイドレーション不一致が起きない。
 */
const TIME_FORMAT = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const MS_PER_SECOND = 1000;

/** `08/26 10:42:13`。日付が壊れていたら潰さずダッシュで逃がす。 */
export function formatLogTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return TIME_FORMAT.format(date);
}

/** 1 秒未満は `412 ms`、それ以上は `10.0 s`（Figma の表記に合わせる）。 */
export function formatLatency(ms: number): string {
  if (ms < MS_PER_SECOND) {
    return `${ms} ms`;
  }
  return `${(ms / MS_PER_SECOND).toFixed(1)} s`;
}

/**
 * request / response をそのまま整形する。
 * 機密値は API 側で `***` に置き換わって届く（AC-15-2）ので、UI では加工しない。
 */
export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "null";
}

export interface LogDetailColumnProps {
  label: string;
  code: string;
  className?: string;
}

/** Log Detail の 1 カラム（Overline + Code Block）。 */
export function LogDetailColumn({
  label,
  code,
  className,
}: LogDetailColumnProps) {
  return (
    <div className={cn("flex min-w-0 flex-1 flex-col gap-1.5", className)}>
      <p className="text-overline text-muted">{label}</p>
      <CodeBlock className="w-full" code={code} />
    </div>
  );
}

export interface LogRowResult {
  label: string;
  tone: "ok" | "warn";
}

export interface LogRowProps {
  time: string;
  command: string;
  /** 操作ログはレジストリ名、AI ログは `プロバイダ / モデル` */
  source: string;
  /** 操作ログは対象ドメイン、AI ログは入力要約 */
  target: string;
  /** 対象列の Text Style（既定は Body/Small） */
  targetClassName?: string;
  result: LogRowResult;
  latency: string;
  expanded: boolean;
  onToggle: () => void;
  /** 展開したときに開く Log Detail */
  children: ReactNode;
}

export function LogRow({
  time,
  command,
  source,
  target,
  targetClassName,
  result,
  latency,
  expanded,
  onToggle,
  children,
}: LogRowProps) {
  const detailId = useId();

  return (
    <li className="flex w-full flex-col">
      {/*
        Figma の 6 列は合計 600px を超えるので、`lg` 未満では 2 行に折る（#95）。
        `lg` で 2 つのラッパーを `display: contents` に落とすと、子が親の flex に
        直接並ぶので、`order-*` で Figma の列順（日時 / コマンド / レジストリ /
        対象 / 結果 / レイテンシ）に戻せる。
      */}
      <button
        aria-expanded={expanded}
        className="flex w-full flex-col gap-1 border-soft border-b border-solid py-1.5 text-left transition-colors hover:bg-hover lg:flex-row lg:items-center lg:gap-2"
        onClick={onToggle}
        type="button"
        {...(expanded ? { "aria-controls": detailId } : {})}
      >
        <span className="flex w-full min-w-0 items-center gap-2 lg:contents">
          <span className="order-1 shrink-0 truncate text-caption text-muted lg:w-27.5">
            {time}
          </span>
          <span className="order-2 min-w-0 flex-1 truncate text-code-label text-ink lg:w-40 lg:flex-none">
            {command}
          </span>
          {/* Figma の各列は overflow-clip。長い結果コードで隣の列を押し出さない */}
          <span className="order-5 flex shrink-0 items-center overflow-hidden lg:w-27.5">
            <Badge
              icon={result.tone === "ok" ? <Check /> : <TriangleAlert />}
              tone={result.tone}
            >
              {result.label}
            </Badge>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "order-7 size-4 shrink-0 text-muted transition-transform motion-reduce:transition-none",
              expanded && "rotate-180",
            )}
          />
        </span>
        <span className="flex w-full min-w-0 items-center gap-2 lg:contents">
          <span className="order-3 shrink-0 truncate text-caption text-muted lg:w-37.5">
            {source}
          </span>
          <span
            className={cn(
              "order-4 min-w-0 flex-1 truncate text-body-sm text-ink",
              targetClassName,
            )}
          >
            {target}
          </span>
          <span className="order-6 shrink-0 truncate text-caption text-muted lg:w-17.5">
            {latency}
          </span>
        </span>
      </button>
      {expanded ? (
        <div
          className="flex w-full flex-col gap-1.5 bg-bg px-4 py-3"
          id={detailId}
        >
          {children}
        </div>
      ) : null}
    </li>
  );
}
