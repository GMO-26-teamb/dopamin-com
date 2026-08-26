// ============================================================
// ドメイン独自性スコア: 入出力型 (zod v4)
// ============================================================
import { z } from "zod";

/** リスクレベル。独自性スコアの逆向き (score>=70 → low risk)。 */
export const riskLevelSchema = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

/** 独自性バンド (検証ハーネスの band() と同じ区分。gold の expect に対応)。 */
export const uniquenessBandSchema = z.enum(["low", "mid", "high"]);
export type UniquenessBand = z.infer<typeof uniquenessBandSchema>;

/** 判定信頼度。3文字以下の短い名前は low (距離指標が不安定なため)。 */
export const confidenceSchema = z.enum(["low", "normal"]);
export type Confidence = z.infer<typeof confidenceSchema>;

/** 最近傍コーパスエントリ 1 件の内訳。 */
export const closestMatchSchema = z.object({
  /** コーパス上の名前 (正規化前) */
  name: z.string(),
  /** このエントリ単体に対する独自性スコア si (丸め前。全体スコアは min の丸め) */
  score: z.number(),
  /** 重み付き lexical 類似度 (0..1) */
  similarity: z.number().min(0).max(1),
  /** スコアを決めたカーブ名 (popularity / floor / derived / contain / edit1 / *+word) */
  curve: z.string(),
  /** エントリの有名度 (0..1) */
  popularity: z.number().min(0).max(1),
});
export type ClosestMatch = z.infer<typeof closestMatchSchema>;

/** scoreDistinctiveness の戻り値。 */
export const uniquenessResultSchema = z.object({
  /** 独自性スコア (0-100 整数。高いほど独自) */
  score: z.number().int().min(0).max(100),
  /** 紛らわしさリスク (score の逆向きバンド) */
  riskLevel: riskLevelSchema,
  /** 判定信頼度 */
  confidence: confidenceSchema,
  /** 近い順の上位マッチ (最大3件) */
  closestMatches: z.array(closestMatchSchema).max(3),
  /** アルゴリズムのバージョン */
  algorithmVersion: z.string(),
  /** 判定に使ったコーパスのバージョン */
  corpusVersion: z.string(),
});
export type UniquenessResult = z.infer<typeof uniquenessResultSchema>;
