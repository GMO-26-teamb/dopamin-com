import {
  type AiProvider,
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

/**
 * プロバイダ別の味付け（`docs/specs/ai-candidates.md` §2.5）。
 *
 * 文体だけに効かせる追加指示で、上の制約を上書きしない。ここに無いプロバイダは
 * 味付け無し = 従来と完全に同じプロンプトになる（`google` / `anthropic` は意図的に空）。
 */
const PROVIDER_FLAVOR: Partial<Record<AiProvider, string>> = {
  // Grok を選ぶ動機は「無難な候補ではなく思わず笑える名前が欲しい」なので、
  // プロバイダの選択をそのまま作風の選択として扱う
  xai: `作風（上の制約はすべてそのまま守ったうえで、文体だけこう振る舞う）:
- 候補名は無難な組み合わせより「なんでそれ!?」と言いたくなる意外性を優先する。
  覚えやすい造語、遊び心のある接尾辞（例: inu を付ける）、語呂やダジャレを歓迎する。
- reason はユーモア文体の短い 1 文にする。基本は大げさに持ち上げる。
  持ち上げの例（トーンの参考。そのまま使わない）:
  「ふわふわ可愛いあなたにぴったり！」
- ただし毎回、候補のうちちょうど 1 件だけを「皮肉枠」にする。
  どれを皮肉枠にするかは自分で選んでよい。皮肉枠の reason は、ほのめかす程度ではなく
  読んだ人がはっきり皮肉だと分かる文体にする。
  皮肉枠の例（トーンの参考。そのまま使わない）:
  「会社の犬のあなたにそっくりな名前。」
  皮肉枠はちょうど 1 件で、残りの候補はすべて持ち上げにする。
- 皮肉枠であっても、下品な表現、攻撃的な表現、人格攻撃、人を傷つける表現は使わない。
  茶化す対象は名前や状況であって、利用者本人の容姿・能力・属性ではない。
  誰かに見せている画面にそのまま出ても問題ない範囲に収める。`,
};

/**
 * システムプロンプト。`provider` を渡すとそのプロバイダの味付けが付く（§2.5）。
 *
 * 味付けを持たないプロバイダ（`google` / `anthropic`）では
 * {@link DOMAIN_CANDIDATES_INSTRUCTIONS} と**文字列として完全に同一**になる。
 */
export function buildDomainCandidatesInstructions(
  provider?: AiProvider,
): string {
  const flavor = provider === undefined ? undefined : PROVIDER_FLAVOR[provider];
  return flavor === undefined
    ? DOMAIN_CANDIDATES_INSTRUCTIONS
    : `${DOMAIN_CANDIDATES_INSTRUCTIONS}\n\n${flavor}`;
}

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
