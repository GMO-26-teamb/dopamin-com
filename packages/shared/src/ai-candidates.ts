/**
 * AI ドメイン候補生成（docs/requirements.md FR-04 / §10.1 `POST /ai/domain-candidates` / §13.2）の
 * 入出力契約。
 *
 * 3 層に分かれている点に注意する。
 * 1. `domainCandidatesRequestSchema` — クライアントからの入力（HTTP）
 * 2. `domainCandidatesOutputSchema` — AI の structured output（信用せず再検証する）
 * 3. `domainCandidatesResponseSchema` — 空き確認（FR-03）と独自性スコア（FR-05）を
 *    足したクライアントへの応答
 */

import { z } from "zod";
import { domainCheckResultSchema } from "./api";
import { sldSchema, tldSchema } from "./domain-name";

/** 候補の件数（FR-04 / AC-04-1「候補は必ず 6 件」）。 */
export const DOMAIN_CANDIDATE_COUNT = 6;

/** 理由文の上限（FR-04「理由（40字以内）」）。 */
export const DOMAIN_CANDIDATE_REASON_MAX_LENGTH = 40;

/**
 * `POST /ai/domain-candidates` の入力（FR-04）。
 * UI ラベルは「ニックネームまたはアプリ名」だが、API のパラメータ名は `nickname`（§10.1）。
 */
export const domainCandidatesRequestSchema = z.object({
  nickname: z.string().trim().min(1).max(64),
  /** 用途・キーワード（任意）。 */
  purpose: z.string().trim().max(200).optional(),
  /** 希望 TLD（任意）。既定は全対応 TLD。 */
  tlds: z.array(tldSchema).min(1).max(22).optional(),
  /** 「もう一度考える」で前回の候補を除外するためのリスト（FQDN でも SLD でも可）。 */
  exclude: z.array(z.string().trim().min(1).max(253)).max(30).optional(),
});
export type DomainCandidatesRequest = z.infer<
  typeof domainCandidatesRequestSchema
>;

/** 検証済みの候補 1 件（§13.2）。応答に載るのはこの形だけ。 */
export const domainCandidateSchema = z.object({
  sld: sldSchema,
  tld: tldSchema,
  /** 日本語の理由（40 字以内）。 */
  reason: z.string().trim().min(1).max(DOMAIN_CANDIDATE_REASON_MAX_LENGTH),
});
export type DomainCandidate = z.infer<typeof domainCandidateSchema>;

/**
 * AI が返す候補 1 件の「素の形」。
 *
 * ここを {@link domainCandidateSchema} のように厳しくすると、1 件でも RFC 1035 違反が
 * 混ざった瞬間に `generateObject` が応答全体を捨ててしまい、残りの正しい候補まで失う。
 * 形（3 つの文字列）だけをここで保証し、値の妥当性は候補 1 件ずつ
 * `domainCandidateSchema` で再検証する（AC-04-1「バリデーションを通過したもののみ」）。
 */
export const rawDomainCandidateSchema = z.object({
  sld: z.string().max(253),
  tld: z.string().max(63),
  reason: z.string().max(200),
});
export type RawDomainCandidate = z.infer<typeof rawDomainCandidateSchema>;

/**
 * AI の structured output。件数の上限は「AI に守らせたい制約」と暴走時の歯止めを兼ねる
 * （6 件ちょうど・重複なしはプロンプトで指示し、実際の担保はサービス側で行う）。
 */
export const domainCandidatesOutputSchema = z.object({
  candidates: z
    .array(rawDomainCandidateSchema)
    .min(1)
    .max(DOMAIN_CANDIDATE_COUNT * 4),
});
export type DomainCandidatesOutput = z.infer<
  typeof domainCandidatesOutputSchema
>;

/**
 * 応答の候補 1 件。AI の出力（`sld` / `tld` / `reason`）に、
 * FR-03 の空き確認と FR-05 の独自性スコアを載せた `check` を足したもの。
 */
export const domainCandidateResultSchema = domainCandidateSchema.extend({
  check: domainCheckResultSchema,
});
export type DomainCandidateResult = z.infer<typeof domainCandidateResultSchema>;

/** `POST /ai/domain-candidates` の応答（FR-04）。 */
export const domainCandidatesResponseSchema = z.object({
  candidates: z.array(domainCandidateResultSchema),
});
export type DomainCandidatesResponse = z.infer<
  typeof domainCandidatesResponseSchema
>;

/**
 * 除外リストの照合キー。`dopamin.com` と `dopamin` のどちらで渡されても
 * 同じ SLD として弾けるよう、TLD を落として小文字化する。
 */
export function excludeKey(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const dot = trimmed.indexOf(".");
  return dot === -1 ? trimmed : trimmed.slice(0, dot);
}
