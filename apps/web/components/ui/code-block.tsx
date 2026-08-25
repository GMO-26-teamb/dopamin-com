"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * Figma: Code Block `48:507`
 * コピー用コードブロック（DNS 手順・NS レコード）。色は両モード共通。
 */
const COPIED_LABEL = "コピーしました";
const COPIED_RESET_MS = 2000;

export interface CodeBlockProps {
  code: string;
  copyLabel?: string;
  className?: string;
}

export function CodeBlock({
  code,
  copyLabel = "コピー",
  className,
}: CodeBlockProps) {
  // コピーした時刻（0 = 未コピー）。連続クリックでも毎回タイマーを張り直せるよう値を変える
  const [copiedAt, setCopiedAt] = useState(0);
  const copied = copiedAt > 0;

  useEffect(() => {
    if (copiedAt === 0) {
      return;
    }
    const timer = window.setTimeout(() => setCopiedAt(0), COPIED_RESET_MS);
    return () => window.clearTimeout(timer);
  }, [copiedAt]);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedAt(Date.now());
    } catch {
      // クリップボードが使えない環境（未許可・非セキュアコンテキスト）では黙って諦める
      setCopiedAt(0);
    }
  }

  return (
    <div className={cn("w-full bg-code-bg", className)}>
      <div className="flex items-start gap-2 p-3">
        <pre className="min-w-0 flex-1 overflow-x-auto text-code text-code-fg">
          <code>{code}</code>
        </pre>
        <Button
          className="shrink-0 border-code-fg text-code-fg"
          leadingIcon={copied ? <Check /> : <Copy />}
          onClick={() => {
            void copy();
          }}
          size="sm"
          variant="subtle"
        >
          {copied ? COPIED_LABEL : copyLabel}
        </Button>
      </div>
      <span aria-live="polite" className="sr-only">
        {copied ? COPIED_LABEL : ""}
      </span>
    </div>
  );
}
