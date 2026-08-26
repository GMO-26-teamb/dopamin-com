// 独自性スコアモジュールの公開エントリポイント。
// 文字列距離・ビュー正規化などの内部ヘルパと同梱辞書データ (COMMON_WORDS_EN) は
// 意図的に再公開しない (テスト等で必要な場合は実装モジュールから直接 import する)。
export * from "./corpus";
export * from "./types";
export {
  AFFIXES,
  ALGORITHM_VERSION,
  DEFAULT_PARAMS,
  riskLevelOf,
  type ScoreOptions,
  scoreDistinctiveness,
  type UniquenessParams,
  uniquenessBand,
} from "./uniqueness";
export {
  createWordChecker,
  DICT_EXTRA,
  DICT_JP,
  getDefaultWordChecker,
  type WordChecker,
} from "./wordlist";
