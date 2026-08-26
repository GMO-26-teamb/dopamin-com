// ============================================================
// コーパス型とロード用インターフェース
// fs / DB は呼ばない。呼び出し側 (Backend) が DB 等から取り出した配列を
// prepareCorpus に渡し、返った PreparedCorpus を scoreDistinctiveness に渡す。
// ============================================================
import { z } from "zod";
import {
  charHist,
  DEFAULT_PARAMS,
  normBase,
  normCompact,
  normPhonetic,
  normVisual,
  normVisualI,
  type UniquenessParams,
} from "./uniqueness";

/** コーパスの層。tranco はランク付き、jp / tech は curated (固定有名度)。 */
export const corpusTierSchema = z.enum(["tranco", "jp", "tech"]);
export type CorpusTier = z.infer<typeof corpusTierSchema>;

/** コーパス1件 (DB の行に対応する素の形)。 */
export const corpusEntrySchema = z.object({
  name: z.string().min(1),
  tier: corpusTierSchema,
  /** tranco 層のみ使用。1 が最有名 */
  rank: z.number().int().positive().optional(),
});
export type CorpusEntry = z.infer<typeof corpusEntrySchema>;

/** 前処理済みコーパス1件 (正規化ビュー・ヒストグラム・有名度を事前計算)。 */
export interface PreparedCorpusEntry extends CorpusEntry {
  vBase: string;
  vCompact: string;
  vVisual: string;
  vVisualI: string;
  vPhonetic: string;
  /** vVisualI の文字ヒストグラム (プレフィルタ1用) */
  hist: Int16Array;
  /** 有名度 0..1 */
  pop: number;
}

/** 前処理済みコーパス。corpusVersion はこの単位で管理する。 */
export interface PreparedCorpus {
  /** コーパスのバージョン識別子 (例: "2026-08-26-tranco10k+curated600")。結果に転記される */
  version: string;
  entries: PreparedCorpusEntry[];
}

/** 有名度: jp / tech は固定、tranco は rank の対数減衰 (rank1=1.0, 100=0.5, 10k=0)。 */
export function popularity(
  entry: CorpusEntry,
  P: UniquenessParams = DEFAULT_PARAMS,
): number {
  if (entry.tier === "jp") return P.popJp;
  if (entry.tier === "tech") return P.popTech;
  return Math.max(0, 1 - Math.log10(Math.max(1, entry.rank ?? 1)) / 4);
}

/**
 * 素のコーパス配列を前処理する。起動時 (またはコーパス更新時) に1回だけ呼び、
 * 結果を使い回す想定。純粋関数で fs / DB には触れない。
 */
export function prepareCorpus(
  entries: readonly CorpusEntry[],
  options: { version: string; params?: UniquenessParams },
): PreparedCorpus {
  const P = options.params ?? DEFAULT_PARAMS;
  return {
    version: options.version,
    entries: entries.map((e) => {
      const vVisualI = normVisualI(e.name);
      return {
        ...e,
        vBase: normBase(e.name),
        vCompact: normCompact(e.name),
        vVisual: normVisual(e.name),
        vVisualI,
        vPhonetic: normPhonetic(e.name),
        hist: charHist(vVisualI),
        pop: popularity(e, P),
      };
    }),
  };
}
