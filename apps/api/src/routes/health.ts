import { RegistryError } from "@dopamin/registry";
import type { HealthResponse, RegistryHealth } from "@dopamin/shared";
import { Hono } from "hono";
import { getRegistrySet } from "../lib/registries";
import type { AppEnv } from "../types";

/**
 * 稼働確認（docs/requirements.md §10.1）。
 * API 自体が生きていれば status は "ok"。各レジストリの疎通結果は registries に載せる。
 * /health は認証なしで到達できるため、エラーは正規化コードのみ返す（生メッセージは出さない）。
 */
export const health = new Hono<AppEnv>().get("/", async (c) => {
  const registries = await Promise.all(
    getRegistrySet()
      .all()
      .map(async (adapter): Promise<RegistryHealth> => {
        const started = Date.now();
        try {
          await adapter.hello();
          return { id: adapter.id, ok: true, latencyMs: Date.now() - started };
        } catch (err) {
          return {
            id: adapter.id,
            ok: false,
            latencyMs: Date.now() - started,
            error: err instanceof RegistryError ? err.code : "INTERNAL",
          };
        }
      }),
  );
  const body: HealthResponse = { status: "ok", registries };
  return c.json(body);
});
