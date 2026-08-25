import { Hono } from "hono";
import { errorHandler } from "./middleware/error-handler";
import { originCheck } from "./middleware/origin-check";
import { auth } from "./routes/auth";
import { health } from "./routes/health";

// ルートはメソッドチェーンで登録する（Hono RPC の型推論に必要）
const app = new Hono()
  .basePath("/api/v1")
  .use(originCheck)
  .route("/health", health)
  .route("/auth", auth)
  .onError(errorHandler);

export type AppType = typeof app;
export default app;
