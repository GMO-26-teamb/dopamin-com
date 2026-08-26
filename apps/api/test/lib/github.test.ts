import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetApiEnvCacheForTesting } from "../../src/lib/env";
import { ApiException } from "../../src/lib/errors";
import {
  fetchRepoSummary,
  GithubUnavailableError,
  parseRepoUrl,
  README_EXCERPT_BYTES,
  repoSummarySchema,
  toGithubApiException,
} from "../../src/lib/github";

/**
 * lib/github.ts（docs/requirements.md FR-13 / NFR-05）。
 * `GITHUB_MODE=real` の経路は fetch をスタブして検証し、実際の GitHub は叩かない。
 */

const GITHUB_KEYS = [
  "GITHUB_MODE",
  "GITHUB_MOCK_FAIL_MODE",
  "GITHUB_TOKEN",
] as const;

beforeEach(() => {
  for (const key of GITHUB_KEYS) {
    delete process.env[key];
  }
  resetApiEnvCacheForTesting();
});

afterEach(() => {
  for (const key of GITHUB_KEYS) {
    delete process.env[key];
  }
  resetApiEnvCacheForTesting();
  vi.restoreAllMocks();
});

function useRealMode(token?: string): void {
  process.env.GITHUB_MODE = "real";
  if (token !== undefined) {
    process.env.GITHUB_TOKEN = token;
  }
  resetApiEnvCacheForTesting();
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function base64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

/** パスの部分一致でレスポンスを引くスタブ（順序に依存しないよう Promise.all 前提で組む）。 */
function stubFetch(routes: Record<string, () => Response>) {
  const spy = vi.fn(
    async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);
      for (const [suffix, respond] of Object.entries(routes)) {
        if (url.endsWith(suffix)) {
          return respond();
        }
      }
      return new Response("not found", { status: 404 });
    },
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("parseRepoUrl", () => {
  it("owner / repo に分解し、末尾の / と .git を落とす", () => {
    expect(parseRepoUrl("https://github.com/dopamin/demo")).toEqual({
      owner: "dopamin",
      repo: "demo",
    });
    expect(parseRepoUrl("https://github.com/dopamin/demo.git/")).toEqual({
      owner: "dopamin",
      repo: "demo",
    });
  });

  it("形式が違えば VALIDATION_ERROR", () => {
    expect(() => parseRepoUrl("https://gitlab.com/a/b")).toThrow(ApiException);
  });
});

describe("fetchRepoSummary（GITHUB_MODE=mock）", () => {
  it("ネットワークに出ずフェイク応答を返す", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);

    const summary = await fetchRepoSummary("https://github.com/dopamin/demo");

    expect(spy).not.toHaveBeenCalled();
    expect(repoSummarySchema.safeParse(summary).success).toBe(true);
    expect(summary.owner).toBe("dopamin");
    expect(summary.repo).toBe("demo");
    expect(summary.structureHints).toContain("apps/web");
  });

  it("GITHUB_MOCK_FAIL_MODE で失敗を再現できる（AC-13-2 の手元再現）", async () => {
    for (const [mode, reason] of [
      ["not_found", "not_found"],
      ["rate_limited", "rate_limited"],
      ["unreachable", "unreachable"],
    ] as const) {
      process.env.GITHUB_MOCK_FAIL_MODE = mode;
      resetApiEnvCacheForTesting();
      const error = await fetchRepoSummary(
        "https://github.com/dopamin/demo",
      ).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(GithubUnavailableError);
      expect((error as GithubUnavailableError).reason).toBe(reason);
    }
  });
});

describe("fetchRepoSummary（GITHUB_MODE=real）", () => {
  it("説明・トピック・言語・README・構造ヒント・マニフェストを集める", async () => {
    useRealMode();
    stubFetch({
      "/repos/dopamin/demo": () =>
        jsonResponse({
          name: "demo",
          description: "デモアプリ",
          topics: ["web"],
          private: false,
          owner: { login: "dopamin" },
        }),
      "/readme": () =>
        jsonResponse({ content: base64("# demo\n本文"), encoding: "base64" }),
      "/languages": () => jsonResponse({ CSS: 100, TypeScript: 900 }),
      "/contents/apps": () =>
        jsonResponse([
          { name: "web", type: "dir" },
          { name: "api", type: "dir" },
          { name: "README.md", type: "file" },
        ]),
      "/contents/package.json": () =>
        jsonResponse({
          content: base64('{"name":"demo"}'),
          encoding: "base64",
        }),
      "/contents": () =>
        jsonResponse([
          { name: "apps", type: "dir" },
          { name: "package.json", type: "file" },
        ]),
    });

    const summary = await fetchRepoSummary("https://github.com/dopamin/demo");

    expect(repoSummarySchema.safeParse(summary).success).toBe(true);
    expect(summary.description).toBe("デモアプリ");
    expect(summary.topics).toEqual(["web"]);
    // バイト数の降順
    expect(summary.languages).toEqual(["TypeScript", "CSS"]);
    expect(summary.readmeExcerpt).toBe("# demo\n本文");
    // ディレクトリだけを 1 段展開する
    expect(summary.structureHints).toEqual(["apps/web", "apps/api"]);
    expect(summary.manifests).toEqual([
      { path: "package.json", excerpt: '{"name":"demo"}' },
    ]);
  });

  it("GITHUB_TOKEN があれば Authorization を付ける（無ければ付けない）", async () => {
    useRealMode("ghp_secret");
    const spy = stubFetch({
      "/repos/dopamin/demo": () =>
        jsonResponse({ name: "demo", owner: { login: "dopamin" } }),
      "/contents": () => jsonResponse([]),
      "/languages": () => jsonResponse({}),
    });

    await fetchRepoSummary("https://github.com/dopamin/demo");

    const init = spy.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer ghp_secret");
  });

  it("README が無くても（404）解析は続く", async () => {
    useRealMode();
    stubFetch({
      "/repos/dopamin/demo": () =>
        jsonResponse({ name: "demo", owner: { login: "dopamin" } }),
      "/readme": () => new Response("", { status: 404 }),
      "/contents": () => jsonResponse([]),
      "/languages": () => jsonResponse({}),
    });

    const summary = await fetchRepoSummary("https://github.com/dopamin/demo");

    expect(summary.readmeExcerpt).toBeNull();
    expect(summary.manifests).toEqual([]);
  });

  it("README は先頭 8KB までしか読まない", async () => {
    useRealMode();
    const long = "あ".repeat(20_000);
    stubFetch({
      "/repos/dopamin/demo": () =>
        jsonResponse({ name: "demo", owner: { login: "dopamin" } }),
      "/readme": () =>
        jsonResponse({ content: base64(long), encoding: "base64" }),
      "/contents": () => jsonResponse([]),
      "/languages": () => jsonResponse({}),
    });

    const summary = await fetchRepoSummary("https://github.com/dopamin/demo");

    expect(
      Buffer.byteLength(summary.readmeExcerpt ?? "", "utf8"),
    ).toBeLessThanOrEqual(README_EXCERPT_BYTES);
  });

  it("404 / 403 は not_found（非公開リポは「取得できません」になる）", async () => {
    useRealMode();
    for (const status of [404, 403]) {
      stubFetch({
        "/repos/dopamin/demo": () => new Response("", { status }),
      });
      const error = await fetchRepoSummary(
        "https://github.com/dopamin/demo",
      ).then(
        () => null,
        (e: unknown) => e,
      );
      expect((error as GithubUnavailableError).reason).toBe("not_found");
    }
  });

  it("429 とレート制限の 403 は rate_limited", async () => {
    useRealMode();
    stubFetch({
      "/repos/dopamin/demo": () => new Response("", { status: 429 }),
    });
    let error = await fetchRepoSummary("https://github.com/dopamin/demo").then(
      () => null,
      (e: unknown) => e,
    );
    expect((error as GithubUnavailableError).reason).toBe("rate_limited");

    stubFetch({
      "/repos/dopamin/demo": () =>
        new Response("", {
          status: 403,
          headers: { "x-ratelimit-remaining": "0" },
        }),
    });
    error = await fetchRepoSummary("https://github.com/dopamin/demo").then(
      () => null,
      (e: unknown) => e,
    );
    expect((error as GithubUnavailableError).reason).toBe("rate_limited");
  });

  it("スキーマに合わない応答は解析失敗にする（NFR-05）", async () => {
    useRealMode();
    stubFetch({
      "/repos/dopamin/demo": () => jsonResponse({ unexpected: true }),
    });

    const error = await fetchRepoSummary(
      "https://github.com/dopamin/demo",
    ).then(
      () => null,
      (e: unknown) => e,
    );

    expect((error as GithubUnavailableError).reason).toBe("unreachable");
  });
});

describe("toGithubApiException", () => {
  it("rate_limited は RATE_LIMITED（429・再試行可）", () => {
    const api = toGithubApiException(
      new GithubUnavailableError("rate_limited"),
    );
    expect(api.code).toBe("RATE_LIMITED");
    expect(api.retryable).toBe(true);
  });

  it("それ以外は NOT_FOUND で「取得できません」を返す（AC-13-2）", () => {
    for (const reason of ["not_found", "unreachable"] as const) {
      const api = toGithubApiException(new GithubUnavailableError(reason));
      expect(api.code).toBe("NOT_FOUND");
      expect(api.message).toContain("取得できません");
    }
  });
});
