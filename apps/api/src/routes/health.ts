import { type RegistryAdapter, RegistryError } from "@dopamin/registry";
import type { DbHealth, HealthResponse, RegistryHealth } from "@dopamin/shared";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../lib/db";
import { getRegistrySet } from "../lib/registries";
import { withReadRetry } from "../lib/retry";
import type { AppEnv } from "../types";

/**
 * 稼働確認（docs/requirements.md §10.1 / §11.5 手順 4）。
 *
 * API 自体が生きていれば `status` は "ok" で、レジストリと DB の疎通結果は個別の項目に載せる。
 * **依存の解決（環境変数の検証を含む）ごと try で包む**のが要点: 疎通確認そのものが
 * 環境不備で 500 になると「どこが壊れているか」を確認する手段が無くなる。
 *
 * 認証なしで到達できるため、エラーは正規化コード・例外名だけを返す
 * （接続文字列やレジストリの生メッセージは出さない）。
 */

/** DB 接続の確認（`select 1`）。`getDb()` は `env()` を通るので解決ごと包む。 */
async function checkDb(): Promise<DbHealth> {
  const started = Date.now();
  try {
    await getDb().execute(sql`select 1`);
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.name : "UnknownError",
    };
  }
}

/** レジストリ 1 つの疎通確認（`hello`）。 */
async function checkRegistry(
  adapter: RegistryAdapter,
): Promise<RegistryHealth> {
  const started = Date.now();
  const base = { id: adapter.id, specVersion: adapter.specVersion };
  try {
    await withReadRetry(() => adapter.hello());
    return { ...base, ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ...base,
      ok: false,
      latencyMs: Date.now() - started,
      error: err instanceof RegistryError ? err.code : "INTERNAL",
    };
  }
}

/**
 * アダプタ集合の組み立て自体が失敗する場合（レジストリの環境変数欠落など）は
 * 空配列にする。DB の結果だけでも返せる方が、全体 500 より診断に役立つ。
 */
function adapters(): RegistryAdapter[] {
  try {
    return getRegistrySet().all();
  } catch {
    return [];
  }
}

export const health = new Hono<AppEnv>().get("/", async (c) => {
  const [registries, db] = await Promise.all([
    Promise.all(adapters().map(checkRegistry)),
    checkDb(),
  ]);
  const body: HealthResponse = { status: "ok", registries, db };
  return c.json(body);
});
