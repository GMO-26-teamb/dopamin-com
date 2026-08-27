/**
 * 独自性スコア（0〜100）からラベル / レアリティ表示を導出する（docs/requirements.md §9.2 / §14.2）。
 *
 * ラベルの境界（40 / 70）は実装が固定で持つ。環境変数（`UNIQUENESS_THETA_*`）による較正は
 * 埋め込み方式が前提だったため、ADR-0003 で lexical 方式に変えた時点で不採用になった。
 */

export type UniquenessLabel = "high" | "medium" | "low";

export function uniquenessLabel(score: number): UniquenessLabel {
  if (score >= 70) {
    return "high";
  }
  if (score >= 40) {
    return "medium";
  }
  return "low";
}

export type RarityTier = "SSR" | "R" | "N";

const RARITY_BY_LABEL: Record<UniquenessLabel, RarityTier> = {
  high: "SSR",
  medium: "R",
  low: "N",
};

export function rarityTier(score: number): RarityTier {
  return RARITY_BY_LABEL[uniquenessLabel(score)];
}

// FR-05 スコアリング実装 (scoreDistinctiveness / prepareCorpus / 一般語判定など) を
// パッケージ公開入口 (src/index.ts → 本ファイル) から到達可能にする。
// 上記の uniquenessLabel / rarityTier (表示用の既存API) はそのまま維持する。
export * from "./uniqueness/index";
