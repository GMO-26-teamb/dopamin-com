import type { AppType } from "@dopamin/api";
import { hc } from "hono/client";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:8787";

/**
 * Hono RPC クライアント（サーバー側: RSC / Route Handler 用）。
 * ブラウザ（Client Component）から呼ぶ場合は `hc<AppType>("")` で同一オリジンの
 * `/api/*` を叩く（next.config.ts の rewrites で API に転送される）。
 */
export const serverApi = hc<AppType>(API_ORIGIN);
