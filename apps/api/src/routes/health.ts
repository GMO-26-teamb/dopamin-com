import type { HealthResponse } from "@dopamin/shared";
import { Hono } from "hono";

export const health = new Hono().get("/", (c) => {
  const body: HealthResponse = { status: "ok" };
  return c.json(body);
});
