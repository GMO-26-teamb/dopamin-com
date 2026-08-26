import {
  DOMAIN_CANDIDATE_COUNT,
  DOMAIN_CANDIDATE_REASON_MAX_LENGTH,
  type DomainCandidatesRequest,
} from "@dopamin/shared";

/**
 * ドメイン候補生成のプロンプト（docs/requirements.md §13.2 / FR-04）。
 *
 * 要点（§13.2）: RFC 1035 準拠、6 件、重複禁止、除外リスト尊重、日本語の理由 40 字以内、
 * TLD は許可リスト内。ここでの指示は「AI に守らせたい制約」であって保証ではないので、
 * 出力は services/candidates.service.ts が必ず再検証する（§13.1）。
 *
 * プロンプト全文は `ai_logs` に保存しない（AC-14-2）。記録されるのは
 * `runStructured` に渡す `input`（ニックネーム等の意味的な入力）の要約だけ。
 */
export const DOMAIN_CANDIDATES_INSTRUCTIONS = `あなたはドメイン名のネーミングを支援するアシスタントです。
入力されたニックネーム（またはアプリ名）と用途から、覚えやすく独自性のあるドメイン名の候補を提案します。

守るべき制約:
- 候補はちょうど ${DOMAIN_CANDIDATE_COUNT} 件。
- SLD は RFC 1035 準拠（小文字の英数字とハイフンのみ、先頭と末尾はハイフン不可、1〜63 文字）。日本語・記号・ドットは含めない。
- TLD は必ず指定された許可リストの中から選ぶ。先頭のドットは付けない。
- 同じ「SLD.TLD」の組み合わせを 2 回以上出さない。
- 除外リストに挙がった名前（および同じ SLD）は提案しない。
- reason は日本語で ${DOMAIN_CANDIDATE_REASON_MAX_LENGTH} 字以内。なぜその名前が良いかを一言で書く。
- 既存の有名サービスやブランドと紛らわしい名前は避ける。`;

/** 候補生成のユーザープロンプト（入力を JSON ではなく箇条書きで渡す）。 */
export function buildDomainCandidatesPrompt(input: {
  request: DomainCandidatesRequest;
  /** 実際に選ばせる TLD（未指定なら全対応 TLD が入る）。 */
  tlds: readonly string[];
  /** 前回の候補 + 再生成時に弾かれた名前を合わせた除外リスト（SLD 表記）。 */
  exclude: readonly string[];
}): string {
  const { request, tlds, exclude } = input;
  const lines = [
    `ニックネームまたはアプリ名: ${request.nickname}`,
    `用途・キーワード: ${request.purpose ?? "（指定なし）"}`,
    `使ってよい TLD: ${tlds.join(", ")}`,
    `除外する名前: ${exclude.length === 0 ? "（なし）" : exclude.join(", ")}`,
    `候補の件数: ${DOMAIN_CANDIDATE_COUNT}`,
  ];
  return lines.join("\n");
}
