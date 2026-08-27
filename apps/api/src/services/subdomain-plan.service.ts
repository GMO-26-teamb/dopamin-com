import type { Db } from "@dopamin/db";
import type {
  AuthUser,
  DnsRecord,
  SubdomainPlanGenerateRequest,
  SubdomainPlanProposalResponse,
  SubdomainPlanResponse,
  SubdomainPlanSaveRequest,
  SubdomainPlanSummary,
} from "@dopamin/shared";
import {
  buildDnsSetupInstructions,
  subdomainApplyState,
  subdomainProposalSchema,
} from "@dopamin/shared";
import { runStructured } from "../lib/ai-provider";
import { ApiException } from "../lib/errors";
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
import {
  findSubdomainPlan,
  listDnsRecords,
  type SubdomainPlanRecord,
  upsertSubdomainPlan,
} from "./subdomain-plan-store";

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
 * 上限は GitHub 解析 8 秒 + AI 20 秒で AC-13-1 の 30 秒に収める。
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

// ---------------------------------------------------------------------------
// 保存 / 取得（§10.1 `PUT` / `GET /domains/:name/subdomain-plan`）
// ---------------------------------------------------------------------------

/**
 * 保存済みの設計をレスポンスの形にする。
 *
 * 各ホストの反映状態は、保存済み設計と疑似 DNS ゾーンの突き合わせで毎回導出する
 * （AC-13-6: 反映後に編集して保存すると、そのホストだけ `changed` になる）。
 * DB にバッジの状態を持たせないのは、`dns_records` 側だけが変わったときに
 * 実体とズレるのを避けるため。
 */
function toPlanResponse(
  domain: string,
  plan: SubdomainPlanRecord,
  records: readonly DnsRecord[],
): SubdomainPlanResponse {
  return {
    domain,
    repoUrl: plan.repoUrl,
    policy: plan.proposal.policy,
    items: plan.proposal.items.map((item) => ({
      ...item,
      applyState: subdomainApplyState(item, records),
    })),
    savedAt: plan.savedAt.toISOString(),
    appliedAt: plan.appliedAt === null ? null : plan.appliedAt.toISOString(),
    // FR-13「手動設定」: 外部 DNS を使う人向けのコピー用テキスト
    instructions: buildDnsSetupInstructions(domain, plan.proposal.items),
  };
}

/**
 * FR-13 / AC-13-3: 編集した設計を保存する（1 ドメイン 1 件の upsert）。
 * 保存では DNS を変えないので、既に反映済みなら `appliedAt` はそのまま残り、
 * 内容が変わったホストが `changed` に倒れる（AC-13-6）。
 */
export async function saveSubdomainPlan(
  db: Db,
  domain: string,
  domainId: string,
  request: SubdomainPlanSaveRequest,
): Promise<SubdomainPlanResponse> {
  const plan = await upsertSubdomainPlan(db, {
    domainId,
    repoUrl: request.repoUrl ?? null,
    proposal: { policy: request.policy, items: request.items },
  });
  return toPlanResponse(domain, plan, await listDnsRecords(db, domainId));
}

/**
 * FR-07 の詳細に載せる件数（`hosts` / `applied`）。まだ保存していなければ null。
 *
 * 設計が無いドメインの方が多いので、先に設計を 1 件引き、あったときだけ
 * 疑似 DNS ゾーンを読む（クエリは最大 2 回で、ホスト数に比例して増えない）。
 * 反映済みの判定は保存済み設計とゾーンの突き合わせで、`GET /subdomain-plan` の
 * `applyState` と同じ `subdomainApplyState` を使う（2 つの画面で数が食い違わない）。
 */
export async function getSubdomainPlanSummary(
  db: Db,
  domainId: string,
): Promise<SubdomainPlanSummary | null> {
  const plan = await findSubdomainPlan(db, domainId);
  if (plan === null) {
    return null;
  }
  const records = await listDnsRecords(db, domainId);
  const { items } = plan.proposal;
  return {
    hosts: items.length,
    applied: items.filter(
      (item) => subdomainApplyState(item, records) === "applied",
    ).length,
  };
}

/**
 * FR-13 / AC-13-3: 保存済みの設計を各ホストの反映状態つきで返す。
 * まだ保存していないドメインは 404（画面は提案生成へ誘導する）。
 */
export async function getSubdomainPlan(
  db: Db,
  domain: string,
  domainId: string,
): Promise<SubdomainPlanResponse> {
  const plan = await findSubdomainPlan(db, domainId);
  if (plan === null) {
    throw new ApiException(
      "NOT_FOUND",
      "このドメインのサブドメイン設計はまだ保存されていません。",
    );
  }
  return toPlanResponse(domain, plan, await listDnsRecords(db, domainId));
}
