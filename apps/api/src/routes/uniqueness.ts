import {
  getDefaultPreparedCorpus,
  scoreDistinctiveness,
  splitDomainName,
  toDomainUniqueness,
  type UniquenessPreviewResponse,
  uniquenessPreviewRequestSchema,
} from "@dopamin/shared";
import { Hono } from "hono";
import { jsonValidator } from "../lib/validator";
import { unauthenticatedRateLimit } from "../middleware/rate-limit";
import type { AppEnv } from "../types";

/**
 * 独自性スコアのプレビュー（FR-05）。ランディング S-00 の「お試しスコア」が使う。
 *
 * **認証なしで到達できる**ので、次の 2 点でほかの口と性格が違う。
 * - レジストリには一切問い合わせない（空き確認をしない）。外に出るのは
 *   同梱コーパスとの照合結果だけで、ユーザーのデータには触れない。
 * - 接続元ごとの回数を数える（`unauthenticatedRateLimit`）。
 *
 * スコアの計算そのものは `POST /domains/check`（`services/check.service.ts`）と同じ
 * `scoreDistinctiveness` + 既定コーパスで、同じ名前なら同じ値になる。
 */
export const uniqueness = new Hono<AppEnv>().post(
  "/preview",
  unauthenticatedRateLimit,
  jsonValidator(uniquenessPreviewRequestSchema),
  (c) => {
    const input = c.req.valid("json");
    // FQDN で来ても判定に使うのは SLD だけ（check と同じ切り出し方）
    const sld = "sld" in input ? input.sld : splitDomainName(input.name).sld;
    const body: UniquenessPreviewResponse = {
      sld,
      uniqueness: toDomainUniqueness(
        scoreDistinctiveness(sld, getDefaultPreparedCorpus()),
      ),
    };
    return c.json(body);
  },
);
