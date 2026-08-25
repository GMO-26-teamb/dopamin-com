"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useReducedMotion } from "@/lib/theme/use-reduced-motion";

/**
 * 画面遷移の入場アニメーション。`app/(app)/template.tsx` から使う
 * （template はナビゲーションごとに再マウントされるので、これだけで毎回動く）。
 * 下から 8px 持ち上がりつつフェードイン。動きを減らす設定では即表示（要件 §15.3）。
 */
export const PAGE_ENTER_DURATION_S = 0.28;

export interface PageTransitionProps {
  children: ReactNode;
}

export function PageTransition({ children }: PageTransitionProps) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="flex min-w-0 flex-1 flex-col gap-4"
      initial={reduced ? false : { opacity: 0, y: 8 }}
      transition={{ duration: PAGE_ENTER_DURATION_S, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
