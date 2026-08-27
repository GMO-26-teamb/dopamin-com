"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useId, useState } from "react";
import { CodeBlock } from "@/components/ui/code-block";
import type { SubdomainHost } from "@/lib/api/types";
import { zoneFileText } from "./apply-status";

/**
 * S-43 の設定手順テキスト（FR-13「手動設定」）。外部 DNS を使う人だけの導線なので
 * 既定は畳んでおく（常時開いていると反映セクションと同じ幅を取り合う）。
 * Figma: Code Block `48:507`
 */

const TOGGLE_LABEL = "手動で設定する場合";

export interface ManualInstructionsProps {
  hosts: readonly SubdomainHost[];
}

export function ManualInstructions({ hosts }: ManualInstructionsProps) {
  const [open, setOpen] = useState(false);
  const contentId = useId();

  return (
    <section className="flex w-full flex-col gap-2">
      <button
        aria-expanded={open}
        className="inline-flex w-fit items-center gap-1.5 text-overline text-muted transition-colors hover:text-ink"
        onClick={() => setOpen((prev) => !prev)}
        type="button"
        {...(open ? { "aria-controls": contentId } : {})}
      >
        <span
          aria-hidden="true"
          className="inline-flex size-3.5 shrink-0 items-center justify-center [&_svg]:size-full"
        >
          {open ? <ChevronDown /> : <ChevronRight />}
        </span>
        {TOGGLE_LABEL}
      </button>
      {open ? (
        <div id={contentId}>
          <CodeBlock code={zoneFileText(hosts)} />
        </div>
      ) : null}
    </section>
  );
}
