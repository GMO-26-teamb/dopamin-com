import { createRegistrySet } from "@dopamin/registry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../src/index";
import { setRegistrySetForTesting } from "../../src/lib/registries";
import {
  type SessionResolver,
  setSessionResolverForTesting,
} from "../../src/middleware/session";
import { TEST_USER } from "../helpers/session";

/**
 * `/domains` のマウント形（#166）。
 *
 * FR-13（routes/subdomain-plan.ts）を index.ts で `/domains` に重ねてマウントしていた頃は、
 * 両ルーターの `use(requireSession)` が `ALL /api/v1/domains/*` として登録され、
 * FR-13 の 5 ルートだけセッション検証（= `sessions` の SELECT）が 2 回走っていた。
 * ここではセッション解決の呼び出し回数を数えて、全ルートで 1 回であることを固定する。
 *
 * 不正なドメイン名を使うので handler / validator は DB を引く前に 400 で落ちる
 * （検証したいのは requireSession の実行回数だけなので pglite は要らない）。
 */

process.env.REGISTRY_MODE = "mock";
process.env.MOCK_REGISTRY_FAIL_MODE = "none";

const VALID_SESSION = "test-session";
const COOKIE = `dopamin_session=${VALID_SESSION}`;
const BAD_NAME = "not_a_domain";

const JSON_POST: RequestInit = {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
};

/** 認証必須ルートと、その呼び出しに必要な RequestInit。 */
const AUTHED_ROUTES: readonly [string, string, RequestInit?][] = [
  ["FR-02 GET /domains", "/api/v1/domains", undefined],
  ["FR-07 GET /domains/:name", `/api/v1/domains/${BAD_NAME}`, undefined],
  [
    "FR-13 POST /domains/:name/subdomain-plan",
    `/api/v1/domains/${BAD_NAME}/subdomain-plan`,
    JSON_POST,
  ],
  [
    "FR-13 PUT /domains/:name/subdomain-plan",
    `/api/v1/domains/${BAD_NAME}/subdomain-plan`,
    { ...JSON_POST, method: "PUT" },
  ],
  [
    "FR-13 GET /domains/:name/subdomain-plan",
    `/api/v1/domains/${BAD_NAME}/subdomain-plan`,
    undefined,
  ],
  [
    "FR-13 POST /domains/:name/subdomain-plan/apply",
    `/api/v1/domains/${BAD_NAME}/subdomain-plan/apply`,
    { method: "POST" },
  ],
  [
    "FR-13 GET /domains/:name/dns",
    `/api/v1/domains/${BAD_NAME}/dns`,
    undefined,
  ],
];

let sessionChecks = 0;

const countingResolver: SessionResolver = (sessionId) => {
  sessionChecks += 1;
  return Promise.resolve(
    sessionId === VALID_SESSION
      ? { user: TEST_USER, sessionId, extended: false }
      : null,
  );
};

beforeEach(() => {
  sessionChecks = 0;
  setSessionResolverForTesting(countingResolver);
  setRegistrySetForTesting(createRegistrySet({ mode: "mock" }));
  // DB を用意しないので handler が届いたルート（GET /domains）は 500 になる。
  // errorHandler の構造化ログでテスト出力が汚れないようにする
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  setSessionResolverForTesting(null);
  setRegistrySetForTesting(null);
  vi.restoreAllMocks();
});

describe("/domains のマウント（#166）", () => {
  for (const [label, path, init] of AUTHED_ROUTES) {
    it(`${label}: セッション検証は 1 回だけ走る`, async () => {
      sessionChecks = 0;
      await app.request(path, {
        ...init,
        headers: { cookie: COOKIE, ...(init?.headers ?? {}) },
      });
      expect(sessionChecks).toBe(1);
    });
  }

  for (const [label, path, init] of AUTHED_ROUTES) {
    it(`${label}: 未認証は 401（AC-01-3）`, async () => {
      const res = await app.request(path, init);
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("UNAUTHORIZED");
    });
  }
});
