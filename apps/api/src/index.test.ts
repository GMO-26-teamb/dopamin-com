import { describe, expect, it } from "vitest";
import app from "./index";

describe("GET /api/v1/health", () => {
  it("returns { status: 'ok' }", async () => {
    const res = await app.request("/api/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
