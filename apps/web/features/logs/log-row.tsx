"use client";

import { ChevronDown } from "lucide-react";
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
      <button
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 border-soft border-b border-solid py-1.5 text-left transition-colors hover:bg-hover"
        onClick={onToggle}
        type="button"
        {...(expanded ? { "aria-controls": detailId } : {})}
      >
        <span className="w-27.5 shrink-0 truncate text-caption text-muted">
          {time}
        </span>
        <span className="w-40 shrink-0 truncate text-code-label text-ink">
          {command}
        </span>
        <span className="w-37.5 shrink-0 truncate text-caption text-muted">
          {source}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-body-sm text-ink",
            targetClassName,
          )}
        >
          {target}
        </span>
        {/* Figma の各列は overflow-clip。長い結果コードで隣の列を押し出さない */}
        <span className="flex w-27.5 shrink-0 items-center overflow-hidden">
          <Badge tone={result.tone}>{result.label}</Badge>
        </span>
        <span className="w-17.5 shrink-0 truncate text-caption text-muted">
          {latency}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 text-muted transition-transform motion-reduce:transition-none",
            expanded && "rotate-180",
          )}
        />
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
