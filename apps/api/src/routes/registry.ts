import { Hono } from "hono";
import { requireSession } from "../middleware/session";
import { consumePoll } from "../services/poll.service";
import type { AuthedEnv } from "../types";

export const registry = new Hono<AuthedEnv>()
  // NFR-04 / AC-01-3: レジストリ操作を起こすので認証必須
  .use(requireSession)

  /**
   * FR-12 / §10.1: 全レジストリの Poll を消化して `transfers` / `domains` に反映する。
   *
   * 通常は `GET /transfers` と `POST /domains/sync` が同じ処理を裏で走らせるので、
   * このルートはデモ・検証用の明示トリガー。Poll はレジストラ単位のキューで
   * ユーザーごとに分かれないため、消化の対象も全ユーザー分になる（反映先の
   * ユーザーは `domains` / `transfers` の行から引く）。
   */
  .post("/poll", async (c) => {
    return c.json(await consumePoll());
  });
