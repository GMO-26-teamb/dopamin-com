import { Hono } from "hono";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { originCheck } from "./middleware/origin-check";
import { requestId } from "./middleware/request-id";
import { auth } from "./routes/auth";
import { domains } from "./routes/domains";
import { health } from "./routes/health";
import { settings } from "./routes/settings";
import { transfers } from "./routes/transfers";
import type { AppEnv } from "./types";

// ルートはメソッドチェーンで登録する（Hono RPC の型推論に必要）
const app = new Hono<AppEnv>()
  .basePath("/api/v1")
  .use(requestId)
  .use(originCheck)
  .route("/health", health)
  .route("/auth", auth)
  .route("/domains", domains)
  .route("/settings", settings)
  .route("/transfers", transfers);

app.onError(errorHandler);
app.notFound(notFoundHandler);

export type AppType = typeof app;
export default app;
