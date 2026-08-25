import { describe, expect, it } from "vitest";
import { healthResponseSchema, registryHealthSchema } from "./health";

describe("healthResponseSchema", () => {
  it("status ok + レジストリ疎通結果を受理する", () => {
    const body = {
      status: "ok",
      registries: [
        { id: "kitaqsign", ok: true, latencyMs: 120 },
        { id: "kitaqnic", ok: false, latencyMs: 5000, error: "timeout" },
      ],
    };
    expect(healthResponseSchema.parse(body)).toEqual(body);
  });

  it("registries が無いと弾く", () => {
    expect(healthResponseSchema.safeParse({ status: "ok" }).success).toBe(
      false,
    );
  });

  it("status は ok のみ受理する", () => {
    expect(
      healthResponseSchema.safeParse({ status: "down", registries: [] })
        .success,
    ).toBe(false);
  });
});

describe("registryHealthSchema", () => {
  it("未知のレジストリ ID を弾く", () => {
    expect(
      registryHealthSchema.safeParse({ id: "onamae", ok: true, latencyMs: 1 })
        .success,
    ).toBe(false);
  });
});
