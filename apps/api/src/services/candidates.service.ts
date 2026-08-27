import type { Db } from "@dopamin/db";
import {
  type AuthUser,
  DOMAIN_CANDIDATE_COUNT,
  DOMAIN_CANDIDATE_REASON_MAX_LENGTH,
  type DomainCandidate,
  type DomainCandidateResult,
  type DomainCandidatesRequest,
  type DomainCandidatesResponse,
  domainCandidateSchema,
  domainCandidatesOutputSchema,
  domainNameSchema,
  excludeKey,
  isSupportedTld,
  type RawDomainCandidate,
  SUPPORTED_TLDS,
} from "@dopamin/shared";
import {
  AI_CALL_TIMEOUT_MS,
  AI_FALLBACK_MIN_BUDGET_MS,
  runStructured,
} from "../lib/ai-provider";
import { getDb } from "../lib/db";
import { getApiEnv } from "../lib/env";
import {
  buildDomainCandidatesInstructions,
  buildDomainCandidatesPrompt,
} from "../prompts/domain-candidates";
import { checkDomains } from "./check.service";
import { getAiSettingsForUser } from "./settings";

/**
 * AI ドメイン候補生成（docs/requirements.md FR-04 / §10.1 `POST /ai/domain-candidates`）。
 *
 * 生成 → 再検証 → （足りなければ 1 回だけ再生成）→ 空き確認（FR-03）+ 独自性スコア（FR-05）。
 * AI の出力は `generateObject` のスキーマ検証とは別に、候補 1 件ずつを
 * `domainNameSchema` と許可 TLD で再検証する（AC-04-1「バリデーションを通過したもののみ」）。
 */

/** 候補の重複・除外を判定しながら「採用済み」を溜める箱。 */
class CandidateBucket {
  private readonly accepted: DomainCandidate[] = [];
  /** 除外 SLD（ユーザー指定 + 採用済み + 弾いた候補）。再生成時のプロンプトにそのまま渡す。 */
  private readonly excluded: Set<string>;

  constructor(
    exclude: readonly string[],
    private readonly allowedTlds: ReadonlySet<string>,
  ) {
    this.excluded = new Set(exclude.map(excludeKey));
  }

  get items(): DomainCandidate[] {
    return this.accepted;
  }

  get excludeList(): string[] {
    return [...this.excluded];
  }

  get shortfall(): number {
    return DOMAIN_CANDIDATE_COUNT - this.accepted.length;
  }

  /**
   * AI が返した 1 件を検証し、通れば採用する（AC-04-1）。
   * 弾いた候補も除外リストに積むので、再生成で同じ名前が返ってきても無限に繰り返さない。
   *
   * `reason` の 40 字上限は表示上の制約（FR-04）なので、超えた場合は候補を捨てずに
   * 切り詰める。ドメイン名としての妥当性（RFC 1035・許可 TLD）は捨てる基準として扱う。
   */
  add(raw: RawDomainCandidate): void {
    const key = excludeKey(raw.sld);
    if (this.excluded.has(key)) {
      return;
    }
    this.excluded.add(key);
    const parsed = domainCandidateSchema.safeParse({
      sld: raw.sld,
      tld: raw.tld,
      reason: raw.reason.trim().slice(0, DOMAIN_CANDIDATE_REASON_MAX_LENGTH),
    });
    if (!parsed.success) {
      return;
    }
    const candidate = parsed.data;
    if (
      !this.allowedTlds.has(candidate.tld) ||
      !isSupportedTld(candidate.tld)
    ) {
      return;
    }
    // AC-03-3 と同じ検証を FQDN でも通す（ラベル単体では通る長さでも 253 字を超え得る）
    if (
      !domainNameSchema.safeParse(`${candidate.sld}.${candidate.tld}`).success
    ) {
      return;
    }
    if (this.accepted.length < DOMAIN_CANDIDATE_COUNT) {
      this.accepted.push(candidate);
    }
  }
}

export interface GenerateDomainCandidatesOptions {
  /** 既定 `getDb()`。 */
  db?: Db;
  /** 生成 1 回あたりの上限時間（既定 {@link AI_CALL_TIMEOUT_MS}）。 */
  timeoutMs?: number;
}

/**
 * FR-04: 候補 6 件を生成し、空き確認と独自性スコアを付けて返す。
 *
 * 上限時間は「1 リクエスト合計」で {@link AI_CALL_TIMEOUT_MS}（AC-04-2「10 秒以内」）。
 * 再生成は残り予算の範囲でだけ行い、予算を使い切っていれば 1 回目の結果で確定する。
 * 2 回目も呼べた場合、その `runStructured` の失敗は捕捉していないので、そのまま
 * AI_UNAVAILABLE / RATE_LIMITED として外に出る（1 回目に採用した候補も返らない）。
 * 2 回とも応答はあったが 6 件に届かなかったときだけ、揃った分を返す。AI 出力の再検証
 * （RFC 1035・対応 TLD・FQDN）で全件落ちれば **0 件の 200** になり得る。
 */
export async function generateDomainCandidates(
  user: AuthUser,
  request: DomainCandidatesRequest,
  options: GenerateDomainCandidatesOptions = {},
): Promise<DomainCandidatesResponse> {
  const db = options.db ?? getDb();
  const tlds = request.tlds ?? SUPPORTED_TLDS;
  const bucket = new CandidateBucket(request.exclude ?? [], new Set(tlds));
  // 実効 AI 設定は 1 リクエストで 1 回だけ引く（再生成のたびに users を読まない）
  const settings = await getAiSettingsForUser(db, user.id, getApiEnv());
  const totalTimeoutMs = options.timeoutMs ?? AI_CALL_TIMEOUT_MS;
  const startedAt = Date.now();

  for (let attempt = 0; attempt < 2; attempt++) {
    const remainingMs = totalTimeoutMs - (Date.now() - startedAt);
    if (attempt > 0 && remainingMs < AI_FALLBACK_MIN_BUDGET_MS) {
      // 1 回目で予算を使い切った。2 回目を始めても打ち切るだけなので試さない
      break;
    }
    const prompt = buildDomainCandidatesPrompt({
      request,
      tlds,
      exclude: bucket.excludeList,
    });
    const output = await runStructured(
      "domain_candidates",
      domainCandidatesOutputSchema,
      prompt,
      {
        user,
        // AC-14-2: プロンプト全文ではなく意味的な入力だけを ai_logs に残す
        input: {
          nickname: request.nickname,
          purpose: request.purpose,
          tlds,
          exclude: bucket.excludeList,
        },
        // 味付けは「ユーザーが選んだプロバイダ」で決める。runStructured が別プロバイダへ
        // フォールバックしても切り替えない（作風は選択に紐づく。§2.5）
        instructions: buildDomainCandidatesInstructions(settings.provider),
        settings,
        timeoutMs: remainingMs,
        db,
      },
    );
    for (const candidate of output.candidates) {
      bucket.add(candidate);
    }
    if (bucket.shortfall <= 0) {
      break;
    }
  }

  const candidates = bucket.items;
  const checks = await checkDomains(candidates.map((c) => `${c.sld}.${c.tld}`));
  const checkByName = new Map(checks.map((result) => [result.name, result]));

  return {
    candidates: candidates.flatMap<DomainCandidateResult>((candidate) => {
      const check = checkByName.get(`${candidate.sld}.${candidate.tld}`);
      // checkDomains は入力 FQDN を必ず 1 件返すので通常は起きない。
      // 取れなかった候補を「空き確認なし」で見せると登録導線が壊れるので落とす
      return check === undefined ? [] : [{ ...candidate, check }];
    }),
  };
}
