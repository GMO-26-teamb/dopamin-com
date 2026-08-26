import { domainCandidatesRequestSchema } from "@dopamin/shared";
import { Hono } from "hono";
import { jsonValidator } from "../lib/validator";
import { requireSession } from "../middleware/session";
import { generateDomainCandidates } from "../services/candidates.service";
import type { AuthedEnv } from "../types";

/**
 * AI 機能（docs/requirements.md §10.1 `/ai/*`）。全ルート認証必須。
 *
 * 独自性スコア（FR-05）はインメモリの lexical 計算で AI 呼び出しを伴わないため、
 * 専用のエンドポイントは持たない（`POST /domains/check` の応答に含まれる。ADR-0003 /
 * requirements v0.1.14 で `POST /ai/uniqueness` は不採用）。
 */
export const ai = new Hono<AuthedEnv>()
  .use(requireSession)

  /** FR-04: ニックネームまたはアプリ名から候補 6 件 + 空き確認 + 独自性スコア。 */
  .post(
    "/domain-candidates",
    jsonValidator(domainCandidatesRequestSchema),
    async (c) => {
      return c.json(
        await generateDomainCandidates(c.get("user"), c.req.valid("json")),
      );
    },
  );
