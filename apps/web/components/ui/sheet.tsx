"use client";

import { X } from "lucide-react";
import { motion } from "motion/react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ReactNode } from "react";
import { useReducedMotion } from "@/lib/theme/use-reduced-motion";
import { cn } from "@/lib/utils";
import { IconButton } from "./icon-button";

/**
 * Figma: AI Log Panel `77:124`
 * radix Dialog を右ドロワーにしたもの。360px 幅・画面の高さいっぱい・左に 2px の枠。
 * スライドインは `useReducedMotion` が true のとき即時（要件 §15.3）。
 *
 * `modal={false}` にすると背後のオーバーレイを出さず、フォーカストラップも
 * `aria-hidden` も掛けない（radix が非モーダルとして扱う）。開いている間もメインを
 * 操作したい AI ログパネル用（docs/specs/ui-screens.md §1）。
 */

const SIDE = {
  right: "inset-y-0 right-0 border-line border-l-2",
} as const;

const OVERLAY_DURATION_S = 0.16;
const SLIDE_DURATION_S = 0.24;

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: "right";
  title: string;
  children: ReactNode;
  className?: string;
  closeLabel?: string;
  /** false で非モーダル（背後を操作できる）。既定は true */
  modal?: boolean;
}

export function Sheet({
  open,
  onOpenChange,
  side = "right",
  title,
  children,
  className,
  closeLabel = "閉じる",
  modal = true,
}: SheetProps) {
  const reduced = useReducedMotion();

  return (
    <DialogPrimitive.Root modal={modal} onOpenChange={onOpenChange} open={open}>
      <DialogPrimitive.Portal>
        {modal ? (
          <DialogPrimitive.Overlay asChild>
            <motion.div
              animate={{ opacity: 1 }}
              className="fixed inset-0 z-40 bg-overlay"
              data-slot="sheet-overlay"
              initial={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : OVERLAY_DURATION_S }}
            />
          </DialogPrimitive.Overlay>
        ) : null}
        <DialogPrimitive.Content aria-describedby={undefined} asChild>
          <motion.div
            animate={{ x: 0 }}
            className={cn(
              "fixed z-50 flex w-90 max-w-full flex-col gap-3 border-solid bg-panel px-6 py-5 focus:outline-none",
              SIDE[side],
              className,
            )}
            initial={{ x: reduced ? 0 : "100%" }}
            transition={{
              duration: reduced ? 0 : SLIDE_DURATION_S,
              ease: "easeOut",
            }}
          >
            <div className="flex w-full items-center gap-2">
              <DialogPrimitive.Title className="min-w-0 flex-1 text-heading-card text-ink">
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Close asChild>
                <IconButton
                  aria-label={closeLabel}
                  icon={<X />}
                  size="sm"
                  variant="subtle"
                />
              </DialogPrimitive.Close>
            </div>
            <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto">
              {children}
            </div>
          </motion.div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
