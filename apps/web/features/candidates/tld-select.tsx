"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SUPPORTED_TLDS } from "./tlds";

/**
 * ui-screens S-20 / S-24 の「希望 TLD（複数選択、既定: 全対応 TLD）」。
 * Select では 1 つしか選べないので、Badge と同じ見た目のトグル chip を並べる。
 * 選択状態は `aria-pressed` で読み上げ、「すべて」「解除」で一括操作できるようにする。
 */

/** 枠・字送りは Badge `44:48`（Outline / Solid）に合わせる。角丸は使わない。 */
const CHIP =
  "inline-flex shrink-0 items-center border-[length:var(--stroke-medium)] border-solid px-2 py-0.5 text-label-xs transition-colors focus-visible:border-transparent focus-visible:outline-none focus-visible:[border-image:var(--gradient-brand)_1]";
const CHIP_ON = "border-ink bg-ink text-bg";
const CHIP_OFF = "border-muted text-muted hover:bg-hover";

export interface TldMultiSelectProps {
  label: string;
  value: readonly string[];
  onChange: (next: string[]) => void;
  /** 0 件のときなどの警告文（Caption / Warn） */
  error?: string;
  className?: string;
}

export function TldMultiSelect({
  label,
  value,
  onChange,
  error,
  className,
}: TldMultiSelectProps) {
  const messageId = useId();
  const selected = new Set(value);
  const all = selected.size === SUPPORTED_TLDS.length;

  // 並び順は SUPPORTED_TLDS に揃える（リクエストの `tlds` もこの順になる）
  const toggle = (tld: string) => {
    onChange(
      SUPPORTED_TLDS.filter((item) =>
        item === tld ? !selected.has(item) : selected.has(item),
      ),
    );
  };

  return (
    <div className={cn("flex w-full flex-col gap-1.5", className)}>
      <div className="flex w-full flex-wrap items-center gap-2">
        <span aria-hidden="true" className="text-label-sm text-muted">
          {label}
        </span>
        <span className="text-caption text-muted">
          {all
            ? `すべて（${SUPPORTED_TLDS.length} 種）`
            : `${selected.size} / ${SUPPORTED_TLDS.length} 種`}
        </span>
        <span aria-hidden="true" className="min-w-0 flex-1" />
        <Button
          disabled={all}
          onClick={() => onChange([...SUPPORTED_TLDS])}
          size="sm"
          variant="subtle"
        >
          すべて
        </Button>
        <Button
          disabled={selected.size === 0}
          onClick={() => onChange([])}
          size="sm"
          variant="subtle"
        >
          解除
        </Button>
      </div>
      {/* fieldset の暗黙ロールが group。legend は置かず aria-label で名前を付ける */}
      <fieldset
        aria-label={label}
        className="flex w-full flex-wrap gap-1"
        {...(error === undefined ? {} : { "aria-describedby": messageId })}
      >
        {SUPPORTED_TLDS.map((tld) => {
          const pressed = selected.has(tld);
          return (
            <button
              aria-pressed={pressed}
              className={cn(CHIP, pressed ? CHIP_ON : CHIP_OFF)}
              key={tld}
              onClick={() => toggle(tld)}
              type="button"
            >
              .{tld}
            </button>
          );
        })}
      </fieldset>
      {error === undefined ? null : (
        <p
          className="w-full text-caption text-warn"
          id={messageId}
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
