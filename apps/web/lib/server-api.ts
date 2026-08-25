import type { AppType } from "@dopamin/api";
import { hc } from "hono/client";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:8787";

/**
 * Hono RPC クライアント（サーバー側: RSC / Route Handler 用）。
 * ブラウザ（Client Component）から呼ぶ場合は `lib/api/http/client.ts` の `apiClient`
 * （`hc<AppType>("")`）で同一オリジンの `/api/*` を叩く（next.config.ts の rewrites で転送）。
 *
 * ファイル名が `lib/api.ts` だと `@/lib/api` がディレクトリ `lib/api/` ではなくこのファイルに
 * 解決されて紛らわしいため `lib/server-api.ts`。
 */
export const serverApi = hc<AppType>(API_ORIGIN);
