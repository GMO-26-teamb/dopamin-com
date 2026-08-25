import { Hono } from "hono";
import { health } from "./routes/health";

// ルートはメソッドチェーンで登録する（Hono RPC の型推論に必要）
const app = new Hono().basePath("/api/v1").route("/health", health);

export type AppType = typeof app;
export default app;
