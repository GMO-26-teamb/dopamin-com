"use client";

import { CardKicker } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import type { SubdomainHost } from "@/lib/api/types";
import { zoneFileText } from "./apply-status";

/**
 * S-43 右パネル最下段。外部 DNS を使う場合のための設定手順テキスト（FR-13「手動設定」）。
 * Figma: Code Block `48:507`
 */
export interface ManualInstructionsProps {
  hosts: readonly SubdomainHost[];
}

export function ManualInstructions({ hosts }: ManualInstructionsProps) {
  return (
    <section className="flex w-full flex-col gap-2">
      <CardKicker>手動で設定する場合（コピー用）</CardKicker>
      <CodeBlock code={zoneFileText(hosts)} />
    </section>
  );
}
