"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SUPPORTED_TLDS } from "./tlds";

/**
 * ui-screens S-20 / S-24 の「希望 TLD（複数選択、既定: 全対応 TLD）」。
 * 既定が全選択なので、初期表示で 22 個の chip を並べても選択の意味を持たない。
 * 畳んだ要約を既定にして、押して開いたときだけ chip と一括操作を出す（#218）。
 * chip は Select では複数選べないため Badge と同じ見た目のトグルにし、
 * 選択状態は `aria-pressed` で読み上げる。
 */

/** 枠・字送りは Badge `44:48`（Outline / Solid）に合わせる。角丸は使わない。 */
const CHIP =
  "inline-flex shrink-0 items-center border-[length:var(--stroke-medium)] border-solid px-2 py-0.5 text-label-xs transition-colors focus-visible:border-transparent focus-visible:outline-none focus-visible:[border-image:var(--gradient-brand)_1]";
const CHIP_ON = "border-ink bg-ink text-bg";
const CHIP_OFF = "border-muted text-muted hover:bg-hover";

/** 畳んだときの要約。何が選ばれているかが一目で分かる長さに収める。 */
function summarize(value: readonly string[]): string {
  if (value.length === 0) {
    return "未選択";
  }
  if (value.length >= SUPPORTED_TLDS.length) {
    return `すべて（${SUPPORTED_TLDS.length} 種）`;
  }
  const [first, ...rest] = value;
  return rest.length === 0 ? `.${first}` : `.${first} ほか ${rest.length} 種`;
}

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
  const panelId = useId();
  const messageId = useId();
  const [open, setOpen] = useState(false);
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
      <button
        aria-controls={panelId}
        aria-expanded={open}
        className="flex h-control-md w-full shrink-0 items-center gap-2 border-2 border-line border-solid bg-panel px-3 text-body-sm text-ink hover:bg-hover"
        onClick={() => setOpen((prev) => !prev)}
        type="button"
        {...(error === undefined ? {} : { "aria-describedby": messageId })}
      >
        <span className="shrink-0 text-label-sm text-muted">{label}</span>
        <span className="min-w-0 flex-1 truncate text-left">
          {summarize(value)}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 text-muted transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div className="flex w-full flex-col gap-1.5" id={panelId}>
          <div className="flex w-full items-center justify-end gap-2">
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
          <fieldset aria-label={label} className="flex w-full flex-wrap gap-1">
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
        </div>
      ) : null}

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
