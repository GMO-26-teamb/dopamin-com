import {
  subdomainPlanGenerateRequestSchema,
  subdomainPlanSaveRequestSchema,
} from "@dopamin/shared";
import { Hono } from "hono";
import { getDb } from "../lib/db";
import { parseDomainNameParam } from "../lib/params";
import { jsonValidator } from "../lib/validator";
import { requireSession } from "../middleware/session";
import {
  requireOwnedDomain,
  requireOwnedDomainId,
} from "../services/domain.service";
import {
  generateSubdomainPlan,
  getSubdomainPlan,
  saveSubdomainPlan,
} from "../services/subdomain-plan.service";
import type { AuthedEnv } from "../types";

/**
 * サブドメイン設計（docs/requirements.md FR-13 / §10.1 `/domains/:name/subdomain-plan`）。
 * `/domains` に同居させるルートだが、routes/domains.ts（FR-02〜FR-12）とは
 * 関心が違うのでファイルを分け、index.ts で同じ `/domains` に重ねてマウントする。
 */
export const subdomainPlan = new Hono<AuthedEnv>()
  .use(requireSession)

  /**
   * FR-13: リポジトリ解析 → サブドメイン提案（保存前）。
   * リポジトリを取得できないときは、概要テキストがあればそれだけで提案する（AC-13-2）。
   */
  .post(
    "/:name/subdomain-plan",
    jsonValidator(subdomainPlanGenerateRequestSchema),
    async (c) => {
      const name = parseDomainNameParam(c.req.param("name"));
      // NFR-04: 自分が保有していないドメインの設計は作れない。
      // 参照系なので forWrite は付けない（保存するのは PUT）
      await requireOwnedDomain(c.get("user").id, name);
      const { response } = await generateSubdomainPlan(
        c.get("user"),
        name,
        c.req.valid("json"),
      );
      return c.json(response);
    },
  )

  /** FR-13 / AC-13-3: 編集した設計を保存する（1 ドメイン 1 件の upsert）。 */
  .put(
    "/:name/subdomain-plan",
    jsonValidator(subdomainPlanSaveRequestSchema),
    async (c) => {
      const name = parseDomainNameParam(c.req.param("name"));
      const { id } = await requireOwnedDomainId(c.get("user").id, name, {
        forWrite: true,
      });
      return c.json(
        await saveSubdomainPlan(getDb(), name, id, c.req.valid("json")),
      );
    },
  )

  /** FR-13 / AC-13-3・AC-13-6: 保存済みの設計を反映状態つきで返す。 */
  .get("/:name/subdomain-plan", async (c) => {
    const name = parseDomainNameParam(c.req.param("name"));
    const { id } = await requireOwnedDomainId(c.get("user").id, name);
    return c.json(await getSubdomainPlan(getDb(), name, id));
  });
