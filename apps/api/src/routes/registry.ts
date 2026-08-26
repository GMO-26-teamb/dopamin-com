import { Hono } from "hono";
import { getDb } from "../lib/db";
import { requireSession } from "../middleware/session";
import { consumePoll } from "../services/poll.service";
import type { AuthedEnv } from "../types";

export const registry = new Hono<AuthedEnv>()
  // NFR-04 / AC-01-3: レジストリ操作は認証必須
  .use(requireSession)

  /**
   * FR-12: 全レジストリの Poll を消化して `transfers` / `domains` に反映する（§10.1）。
   *
   * 通常は `GET /transfers` と `POST /domains/sync` が「ついで」に消化するので、
   * このルートはデモ・検証用の明示トリガー。通知はレジストラ単位で届くため、
   * 消化されるのはログインユーザーの分だけではない（結果も件数しか返さない）。
   *
   * `consumePollSafely` ではなく `consumePoll` を使うのは、明示的に叩く導線では
   * 失敗を握りつぶさずエラーとして返した方が検証しやすいため。
   */
  .post("/poll", async (c) => {
    return c.json({ poll: await consumePoll(getDb()) });
  });
