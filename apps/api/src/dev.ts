import { serve } from "@hono/node-server";
import app from "./index";

// ローカル開発専用の Node.js サーバー。Vercel 上では src/index.ts の default export が直接使われる。
const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API: http://localhost:${info.port}/api/v1/health`);
});
