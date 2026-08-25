import { cn } from "@/lib/utils";

/**
 * Figma: Similarity Row `48:55`
 * 類似候補の 1 行（名前・ミニバー・スコア）。
 *
 * `similarity` は 0〜1 のコサイン類似度（`UniquenessScore.nearest[].similarity` と同じ単位で、
 * API の `topSimilar` に合わせる）。表示も Figma / `docs/ui-design/14-domains-new.png` の
 * 「takaku 0.61」と同じく小数 2 桁で、百分率にはしない。0.8 以上は Warn。
 */
const SIMILARITY_WARN_THRESHOLD = 0.8;

const TONE = {
  warn: { name: "text-warn", bar: "bg-warn" },
  muted: { name: "text-ink", bar: "bg-muted" },
} as const;

export interface SimilarityRowProps {
  name: string;
  /** 0〜1 のコサイン類似度（0.61 のように表示する） */
  similarity: number;
  /** 省略時は similarity から決める（0.8 以上 = warn） */
  tone?: "warn" | "muted";
  className?: string;
}

export function SimilarityRow({
  name,
  similarity,
  tone,
  className,
}: SimilarityRowProps) {
  const ratio = Number.isFinite(similarity)
    ? Math.min(1, Math.max(0, similarity))
    : 0;
  const resolved =
    tone ?? (ratio >= SIMILARITY_WARN_THRESHOLD ? "warn" : "muted");
  const style = TONE[resolved];

  return (
    <div className={cn("flex w-full items-center gap-2", className)}>
      <span className={cn("min-w-0 flex-1 truncate text-caption", style.name)}>
        {name}
      </span>
      <span className="h-1 w-17.5 shrink-0 overflow-hidden bg-track">
        <span
          className={cn("block h-full", style.bar)}
          style={{ width: `${ratio * 100}%` }}
        />
      </span>
      <span className="shrink-0 text-caption text-muted">
        {ratio.toFixed(2)}
      </span>
    </div>
  );
}
