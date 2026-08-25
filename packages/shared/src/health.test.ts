import { describe, expect, it } from "vitest";
import { healthResponseSchema } from "./health";

describe("healthResponseSchema", () => {
  it("accepts { status: 'ok' }", () => {
    expect(healthResponseSchema.parse({ status: "ok" })).toEqual({
      status: "ok",
    });
  });

  it("rejects other statuses", () => {
    expect(healthResponseSchema.safeParse({ status: "down" }).success).toBe(
      false,
    );
  });
});
