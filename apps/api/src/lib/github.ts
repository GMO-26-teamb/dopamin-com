import { z } from "zod";
import { getApiEnv } from "./env";
import { ApiException } from "./errors";

/**
 * GitHub 公開リポジトリの解析（docs/requirements.md FR-13 / §13.2 / NFR-05）。
 *
 * サブドメイン設計（FR-13）の入力を作るためだけの読み取り専用クライアント。
 * 応答は必ず zod で検証してから使う（NFR-05）。トークンは `apps/api` の環境変数のみが持ち、
 * クライアントには出さない（NFR-03）。
 *
 * `GITHUB_MODE=mock`（既定）ではネットワークに出ず、リポジトリ URL から決まる
 * フェイク応答を返す（`packages/registry` の mock と同じ思想）。実キーが無い環境でも
 * FR-13 の導線を最後まで通せるようにするためで、失敗系は `GITHUB_MOCK_FAIL_MODE` で再現する。
 */

/**
 * 解析全体の上限時間。AC-13-1「提案表示まで 15 秒以内」のうち、AI 呼び出しに
 * {@link import("./ai-provider").AI_CALL_TIMEOUT_MS} の 10 秒を残した配分。
 */
export const GITHUB_FETCH_TIMEOUT_MS = 4_000;

/** README として読む先頭バイト数（FR-13「README（先頭 8KB）」）。 */
export const README_EXCERPT_BYTES = 8 * 1024;

/** マニフェストとして読む 1 ファイルの上限（プロンプトが膨らみすぎないように切る）。 */
const MANIFEST_EXCERPT_BYTES = 2 * 1024;

/** ルート直下にあれば中身を読むマニフェスト（FR-13「`package.json` / `pyproject.toml` 等」）。 */
const MANIFEST_FILES = [
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "composer.json",
  "Gemfile",
] as const;

/** 構造ヒントを取りに行くディレクトリ（FR-13「`apps/` `packages/` `docs/` `api/`」）。 */
const STRUCTURE_DIRS = ["apps", "packages", "docs", "api"] as const;

/** マニフェストは多くても 2 件まで読む（上限時間の配分）。 */
const MAX_MANIFESTS = 2;

const GITHUB_API_ORIGIN = "https://api.github.com";

// ---------------------------------------------------------------------------
// 解析結果（`subdomain_plans.repo_summary` に保存する形）
// ---------------------------------------------------------------------------

/** ルート直下 / サブディレクトリの 1 エントリ。 */
const repoEntrySchema = z.object({
  name: z.string(),
  type: z.enum(["file", "dir", "other"]),
});

/**
 * リポジトリ解析の結果。`subdomain_plans.repo_summary`（jsonb）に保存するので、
 * DB から読み戻すときもこのスキーマで検証する。
 */
export const repoSummarySchema = z.object({
  owner: z.string(),
  repo: z.string(),
  description: z.string().nullable(),
  topics: z.array(z.string()),
  /** バイト数の降順（比率の代わり）。 */
  languages: z.array(z.string()),
  /** README の先頭 8KB。取得できなければ null。 */
  readmeExcerpt: z.string().nullable(),
  rootEntries: z.array(repoEntrySchema),
  /** `apps/web` `packages/shared` のような構造ヒント。 */
  structureHints: z.array(z.string()),
  manifests: z.array(z.object({ path: z.string(), excerpt: z.string() })),
});
export type RepoSummary = z.infer<typeof repoSummarySchema>;

// ---------------------------------------------------------------------------
// GitHub REST API のレスポンス（必要な列だけを検証する）
// ---------------------------------------------------------------------------

const repoResponseSchema = z.object({
  name: z.string(),
  description: z.string().nullable().default(null),
  topics: z.array(z.string()).default([]),
  private: z.boolean().default(false),
  owner: z.object({ login: z.string() }),
});

const readmeResponseSchema = z.object({
  content: z.string(),
  encoding: z.string(),
});

const contentsResponseSchema = z.array(
  z.object({ name: z.string(), type: z.string() }),
);

/** `{ "TypeScript": 12345, ... }`。値はバイト数。 */
const languagesResponseSchema = z.record(z.string(), z.number());

const fileContentResponseSchema = z.object({
  content: z.string(),
  encoding: z.string(),
});

// ---------------------------------------------------------------------------
// URL の分解
// ---------------------------------------------------------------------------

export interface RepoRef {
  owner: string;
  repo: string;
}

/**
 * `https://github.com/<owner>/<repo>` を分解する。
 * 形式そのものの検証は `githubRepoUrlSchema`（packages/shared）が済ませている前提で、
 * ここは分解できなければ VALIDATION_ERROR にする。
 */
export function parseRepoUrl(repoUrl: string): RepoRef {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)$/.exec(
    repoUrl
      .trim()
      .replace(/\/+$/, "")
      .replace(/\.git$/i, ""),
  );
  const owner = match?.[1];
  const repo = match?.[2];
  if (owner === undefined || repo === undefined) {
    throw new ApiException(
      "VALIDATION_ERROR",
      "リポジトリ URL は https://github.com/<owner>/<repo> の形式で指定してください。",
    );
  }
  return { owner, repo };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/** 取得できなかったことを表す（呼び出し側が「取得できません」に変換する。AC-13-2）。 */
export class GithubUnavailableError extends Error {
  constructor(readonly reason: "not_found" | "rate_limited" | "unreachable") {
    super(`GitHub のリポジトリを取得できませんでした（${reason}）`);
    this.name = "GithubUnavailableError";
  }
}

/**
 * 統一エラー（§10.3）への変換。
 * レート制限だけ RATE_LIMITED（429）で、それ以外（存在しない・非公開・通信断）は
 * まとめて NOT_FOUND にして「取得できません」を返す（AC-13-2）。
 */
export function toGithubApiException(
  error: GithubUnavailableError,
): ApiException {
  if (error.reason === "rate_limited") {
    return new ApiException(
      "RATE_LIMITED",
      "GitHub の利用制限に達しました。しばらく待ってから再度お試しください。",
      undefined,
      { retryable: true },
    );
  }
  return new ApiException(
    "NOT_FOUND",
    "リポジトリを取得できません。公開リポジトリの URL か確認するか、プロジェクト概要を入力してください。",
  );
}

/**
 * HTTP ステータスを失敗理由に写す。
 * GitHub はレート制限も 403 で返すので、`x-ratelimit-remaining: 0` のときだけ
 * `rate_limited` として扱う（§10.3 の RATE_LIMITED は「AI・GitHub のレート制限」）。
 */
function reasonForStatus(
  status: number,
  headers: Headers,
): GithubUnavailableError["reason"] {
  if (status === 429) {
    return "rate_limited";
  }
  if (status === 403 && headers.get("x-ratelimit-remaining") === "0") {
    return "rate_limited";
  }
  if (status === 403 || status === 404) {
    return "not_found";
  }
  return "unreachable";
}

/** 認証ヘッダ。トークンはレート制限の緩和用で、公開リポの取得には必須ではない（§17）。 */
function requestHeaders(): Record<string, string> {
  const token = getApiEnv().GITHUB_TOKEN;
  return {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "dopamin-com",
    ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
  };
}

/**
 * GitHub REST API を 1 回叩いて zod で検証する（NFR-05）。
 * `optional: true` の呼び出しは、取得できなくても null を返して解析を続ける
 * （README やマニフェストが無いリポジトリは普通にあるため）。
 */
async function getJson<T>(
  path: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
  options: { optional?: boolean } = {},
): Promise<T | null> {
  let response: Response;
  try {
    response = await fetch(`${GITHUB_API_ORIGIN}${path}`, {
      headers: requestHeaders(),
      signal,
    });
  } catch {
    if (options.optional) {
      return null;
    }
    throw new GithubUnavailableError("unreachable");
  }
  if (!response.ok) {
    const reason = reasonForStatus(response.status, response.headers);
    // レート制限は任意の呼び出しでも致命的（以降すべて失敗するので早く返す）
    if (options.optional && reason !== "rate_limited") {
      return null;
    }
    throw new GithubUnavailableError(reason);
  }
  const parsed = schema.safeParse(await response.json());
  if (parsed.success) {
    return parsed.data;
  }
  if (options.optional) {
    return null;
  }
  // 仕様変更で必須の応答が読めない = 解析できない。AC-13-2 の代替入力へ倒す
  throw new GithubUnavailableError("unreachable");
}

/**
 * UTF-8 バイト列の先頭 `maxBytes` までを文字列にする。
 * 素朴に切ると多バイト文字の途中で分断されて U+FFFD（3 バイト）に置き換わり、
 * かえって上限を超えることがあるので、継続バイト（`10xxxxxx`）を遡って文字境界まで戻す。
 */
function decodeUtf8Prefix(buffer: Buffer, maxBytes: number): string {
  if (buffer.length <= maxBytes) {
    return buffer.toString("utf8");
  }
  let end = maxBytes;
  while (end > 0 && ((buffer[end] ?? 0) & 0b1100_0000) === 0b1000_0000) {
    end -= 1;
  }
  return buffer.subarray(0, end).toString("utf8");
}

/** base64 の内容を UTF-8 文字列にし、先頭 `maxBytes` で切る。 */
function decodeContent(
  value: { content: string; encoding: string },
  maxBytes: number,
): string | null {
  if (value.encoding !== "base64") {
    return null;
  }
  return decodeUtf8Prefix(Buffer.from(value.content, "base64"), maxBytes);
}

// ---------------------------------------------------------------------------
// 解析本体
// ---------------------------------------------------------------------------

async function fetchRealRepoSummary(
  ref: RepoRef,
  signal: AbortSignal,
): Promise<RepoSummary> {
  const base = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  // リポジトリ本体だけは必須。ここが 404 / 403 なら「取得できません」（AC-13-2）
  const repo = await getJson(base, repoResponseSchema, signal);
  if (repo === null) {
    throw new GithubUnavailableError("not_found");
  }

  const [readme, rootContents, languages] = await Promise.all([
    getJson(`${base}/readme`, readmeResponseSchema, signal, { optional: true }),
    getJson(`${base}/contents`, contentsResponseSchema, signal, {
      optional: true,
    }),
    getJson(`${base}/languages`, languagesResponseSchema, signal, {
      optional: true,
    }),
  ]);

  const rootEntries = (rootContents ?? []).map((entry) => ({
    name: entry.name,
    type:
      entry.type === "file" || entry.type === "dir"
        ? (entry.type as "file" | "dir")
        : ("other" as const),
  }));
  const rootNames = new Set(rootEntries.map((entry) => entry.name));

  // 構造ヒント: apps/ packages/ 等の直下を 1 段だけ展開する（FR-13「apps/* ごとに 1 ホスト」）
  const structureHints = (
    await Promise.all(
      STRUCTURE_DIRS.filter((dir) => rootNames.has(dir)).map(async (dir) => {
        const children = await getJson(
          `${base}/contents/${dir}`,
          contentsResponseSchema,
          signal,
          { optional: true },
        );
        if (children === null) {
          return [dir];
        }
        return children
          .filter((child) => child.type === "dir")
          .map((child) => `${dir}/${child.name}`);
      }),
    )
  ).flat();

  const manifests = (
    await Promise.all(
      MANIFEST_FILES.filter((file) => rootNames.has(file))
        .slice(0, MAX_MANIFESTS)
        .map(async (file) => {
          const content = await getJson(
            `${base}/contents/${file}`,
            fileContentResponseSchema,
            signal,
            { optional: true },
          );
          const excerpt =
            content === null
              ? null
              : decodeContent(content, MANIFEST_EXCERPT_BYTES);
          return excerpt === null ? [] : [{ path: file, excerpt }];
        }),
    )
  ).flat();

  return {
    owner: repo.owner.login,
    repo: repo.name,
    description: repo.description,
    topics: repo.topics,
    languages: Object.entries(languages ?? {})
      .sort(([, a], [, b]) => b - a)
      .map(([language]) => language),
    readmeExcerpt:
      readme === null ? null : decodeContent(readme, README_EXCERPT_BYTES),
    rootEntries,
    structureHints,
    manifests,
  };
}

/**
 * `GITHUB_MODE=mock` のフェイク応答。
 * リポジトリ名から決まる決定的な内容を返すので、デモとテストで同じ提案が得られる。
 */
function mockRepoSummary(ref: RepoRef): RepoSummary {
  const failMode = getApiEnv().GITHUB_MOCK_FAIL_MODE;
  if (failMode === "not_found") {
    throw new GithubUnavailableError("not_found");
  }
  if (failMode === "rate_limited") {
    throw new GithubUnavailableError("rate_limited");
  }
  if (failMode === "unreachable") {
    throw new GithubUnavailableError("unreachable");
  }
  return {
    owner: ref.owner,
    repo: ref.repo,
    description: `${ref.repo}（mock）: Web アプリと API を持つモノレポ`,
    topics: ["typescript", "monorepo", "web"],
    languages: ["TypeScript", "CSS"],
    readmeExcerpt: [
      `# ${ref.repo}`,
      "",
      "Next.js の Web アプリと Hono の API からなるモノレポです（mock 応答）。",
      "- `apps/web`: ランディングページとダッシュボード",
      "- `apps/api`: REST API",
      "- `docs`: 仕様書",
    ].join("\n"),
    rootEntries: [
      { name: "apps", type: "dir" },
      { name: "packages", type: "dir" },
      { name: "docs", type: "dir" },
      { name: "package.json", type: "file" },
      { name: "README.md", type: "file" },
    ],
    structureHints: ["apps/web", "apps/api", "packages/shared", "docs"],
    manifests: [
      {
        path: "package.json",
        excerpt: `{ "name": "${ref.repo}", "private": true }`,
      },
    ],
  };
}

/**
 * 公開リポジトリを解析して {@link RepoSummary} を返す（FR-13）。
 * 取得できない場合は {@link GithubUnavailableError} を投げる（呼び出し側が
 * AC-13-2 の代替入力に倒すか、{@link toGithubApiException} で統一エラーに変換する）。
 */
export async function fetchRepoSummary(
  repoUrl: string,
  options: { timeoutMs?: number } = {},
): Promise<RepoSummary> {
  const ref = parseRepoUrl(repoUrl);
  if (getApiEnv().GITHUB_MODE === "mock") {
    return mockRepoSummary(ref);
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? GITHUB_FETCH_TIMEOUT_MS,
  );
  try {
    return await fetchRealRepoSummary(ref, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
