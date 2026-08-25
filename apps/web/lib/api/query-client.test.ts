import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./errors";
import { createQueryClient, expiredLoginUrl } from "./query-client";

function unauthorized(): ApiClientError {
  return new ApiClientError({
    code: "UNAUTHORIZED",
    message: "セッションの有効期限が切れました。",
  });
}

/** 401 を投げるクエリを 1 本走らせる（失敗は握りつぶす）。 */
async function runFailingQuery(
  client: ReturnType<typeof createQueryClient>,
  error: unknown,
): Promise<void> {
  await client
    .fetchQuery({
      queryKey: ["query-client-test", Math.random()],
      queryFn: () => Promise.reject(error),
      retry: false,
    })
    .catch(() => undefined);
}

describe("expiredLoginUrl", () => {
  it("現在地を next に載せる（ui-screens §1）", () => {
    expect(expiredLoginUrl("/domains/takutaku.com")).toBe(
      "/login?reason=expired&next=%2Fdomains%2Ftakutaku.com",
    );
    expect(expiredLoginUrl("/dashboard?mock=stale")).toBe(
      "/login?reason=expired&next=%2Fdashboard%3Fmock%3Dstale",
    );
  });

  it("ループする / 外に出る行き先は next を付けない", () => {
    expect(expiredLoginUrl("/login")).toBe("/login?reason=expired");
    expect(expiredLoginUrl("/")).toBe("/login?reason=expired");
    expect(expiredLoginUrl("//evil.example")).toBe("/login?reason=expired");
  });
});

describe("createQueryClient の 401 ハンドラ", () => {
  it("401 でログイン画面へ送る", async () => {
    const navigate = vi.fn();
    const client = createQueryClient({
      navigate,
      redirectOnUnauthorized: true,
    });

    await runFailingQuery(client, unauthorized());

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0]?.[0]).toMatch(/^\/login\?reason=expired/);
  });

  it("同時に複数が 401 でも遷移は 1 回だけ", async () => {
    const navigate = vi.fn();
    const client = createQueryClient({
      navigate,
      redirectOnUnauthorized: true,
    });

    await Promise.all([
      runFailingQuery(client, unauthorized()),
      runFailingQuery(client, unauthorized()),
      runFailingQuery(client, unauthorized()),
    ]);

    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("ミューテーションの 401 でも送る", async () => {
    const navigate = vi.fn();
    const client = createQueryClient({
      navigate,
      redirectOnUnauthorized: true,
    });

    await client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.reject(unauthorized()) })
      .execute(undefined)
      .catch(() => undefined);

    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("401 以外では送らない", async () => {
    const navigate = vi.fn();
    const client = createQueryClient({
      navigate,
      redirectOnUnauthorized: true,
    });

    await runFailingQuery(
      client,
      new ApiClientError({ code: "NOT_FOUND", message: "ありません。" }),
    );

    expect(navigate).not.toHaveBeenCalled();
  });

  it("モックモード（既定）では送らない（?mock= のエラー画面を乗っ取らない）", async () => {
    const navigate = vi.fn();
    const client = createQueryClient({ navigate });

    await runFailingQuery(client, unauthorized());

    expect(navigate).not.toHaveBeenCalled();
  });
});
