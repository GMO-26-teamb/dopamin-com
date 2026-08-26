import type { Db } from "@dopamin/db";
import type {
  AuthUser,
  SubdomainPlanGenerateRequest,
  SubdomainPlanProposalResponse,
} from "@dopamin/shared";
import { subdomainProposalSchema } from "@dopamin/shared";
import { runStructured } from "../lib/ai-provider";
import {
  fetchRepoSummary,
  GithubUnavailableError,
  type RepoSummary,
  toGithubApiException,
} from "../lib/github";
import {
  buildSubdomainPlanPrompt,
  SUBDOMAIN_PLAN_INSTRUCTIONS,
} from "../prompts/subdomain-plan";

/**
 * サブドメイン設計の提案生成（docs/requirements.md FR-13 / §10.1
 * `POST /domains/:name/subdomain-plan`）。
 *
 * リポジトリを解析 → AI に提案させる → `subdomainProposalSchema` で再検証、までを行う。
 * **保存はしない**（保存は `PUT /domains/:name/subdomain-plan`）。
 */

export interface GenerateSubdomainPlanOptions {
  /** 既定 `getDb()`（`runStructured` 側で解決する）。 */
  db?: Db;
}

/** 提案生成の結果。`summary` は解析できた場合だけ入る（`repo_summary` の素）。 */
export interface GeneratedSubdomainPlan {
  response: SubdomainPlanProposalResponse;
  summary: RepoSummary | null;
}

/**
 * リポジトリ URL があれば解析する。
 *
 * AC-13-2: 取得できない（存在しない・非公開・レート制限）場合、概要テキストが
 * 添えられていればそれだけで提案に進む。概要も無ければ「取得できません」を返す。
 */
async function analyzeRepo(
  request: SubdomainPlanGenerateRequest,
): Promise<RepoSummary | null> {
  if (request.repoUrl === undefined) {
    return null;
  }
  try {
    return await fetchRepoSummary(request.repoUrl);
  } catch (error) {
    if (!(error instanceof GithubUnavailableError)) {
      throw error;
    }
    if (request.description === undefined) {
      throw toGithubApiException(error);
    }
    // 代替入力（概要テキスト）があるので、解析なしで提案に進む
    return null;
  }
}

/**
 * FR-13: リポジトリ解析 → サブドメイン提案。
 *
 * AI 出力は `generateObject` のスキーマ検証とは別に、返す直前で
 * `subdomainProposalSchema` を通す（`runStructured` が同じスキーマで再検証する。§13.1）。
 * 上限は GitHub 解析 4 秒 + AI 10 秒で AC-13-1 の 15 秒に収める。
 */
export async function generateSubdomainPlan(
  user: AuthUser,
  domain: string,
  request: SubdomainPlanGenerateRequest,
  options: GenerateSubdomainPlanOptions = {},
): Promise<GeneratedSubdomainPlan> {
  const summary = await analyzeRepo(request);
  const description = request.description ?? null;

  const proposal = await runStructured(
    "subdomain_plan",
    subdomainProposalSchema,
    buildSubdomainPlanPrompt({ domain, summary, description }),
    {
      user,
      // AC-14-2: プロンプト全文ではなく意味的な入力だけを ai_logs に残す
      input: {
        domain,
        repoUrl: request.repoUrl ?? null,
        // 解析できたかどうかは提案の質に直結するのでログに残す
        analyzed: summary !== null,
        hasDescription: description !== null,
      },
      instructions: SUBDOMAIN_PLAN_INSTRUCTIONS,
      ...(options.db ? { db: options.db } : {}),
    },
  );

  return {
    summary,
    response: {
      domain,
      // 解析できなかった URL も「何を入力したか」として返す（画面が再入力を促せる）
      repoUrl: request.repoUrl ?? null,
      policy: proposal.policy,
      items: proposal.items,
    },
  };
}
