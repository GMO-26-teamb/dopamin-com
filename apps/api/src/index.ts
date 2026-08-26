import { Hono } from "hono";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { originCheck } from "./middleware/origin-check";
import { requestContext } from "./middleware/request-context";
import { requestId } from "./middleware/request-id";
import { ai } from "./routes/ai";
import { auth } from "./routes/auth";
import { domains } from "./routes/domains";
import { health } from "./routes/health";
import { logs } from "./routes/logs";
import { registry } from "./routes/registry";
import { settings } from "./routes/settings";
import { subdomainPlan } from "./routes/subdomain-plan";
import { transfers } from "./routes/transfers";
import type { AppEnv } from "./types";

// ルートはメソッドチェーンで登録する（Hono RPC の型推論に必要）
const app = new Hono<AppEnv>()
  .basePath("/api/v1")
  .use(requestId)
  .use(requestContext)
  .use(originCheck)
  .route("/health", health)
  .route("/auth", auth)
  .route("/domains", domains)
  // FR-13 は関心が違うので別ファイルにし、同じ /domains に重ねてマウントする
  .route("/domains", subdomainPlan)
  .route("/settings", settings)
  .route("/transfers", transfers)
  .route("/registry", registry)
  .route("/logs", logs)
  .route("/ai", ai);

app.onError(errorHandler);
app.notFound(notFoundHandler);

export type AppType = typeof app;
export default app;
