import { describe, expect, it } from "vitest";
import {
  displayNameSchema,
  passkeyVerifyRequestSchema,
  webauthnResponseSchema,
} from "./auth";

describe("displayNameSchema", () => {
  it("accepts 1〜32 文字", () => {
    expect(displayNameSchema.parse("は")).toBe("は");
    expect(displayNameSchema.parse("あ".repeat(32))).toBe("あ".repeat(32));
  });

  it("rejects 空文字", () => {
    expect(displayNameSchema.safeParse("").success).toBe(false);
  });

  it("rejects 33 文字", () => {
    expect(displayNameSchema.safeParse("あ".repeat(33)).success).toBe(false);
  });

  it("rejects 空白のみ", () => {
    expect(displayNameSchema.safeParse("   ").success).toBe(false);
  });

  it("trims 前後の空白", () => {
    expect(displayNameSchema.parse("  はるか  ")).toBe("はるか");
  });
});

describe("webauthnResponseSchema", () => {
  const minimal = {
    id: "abc",
    rawId: "abc",
    type: "public-key",
    response: { clientDataJSON: "..." },
  };

  it("accepts 最小限の形", () => {
    expect(webauthnResponseSchema.safeParse(minimal).success).toBe(true);
  });

  it("rejects type が public-key 以外", () => {
    expect(
      webauthnResponseSchema.safeParse({ ...minimal, type: "password" })
        .success,
    ).toBe(false);
  });
});

describe("passkeyVerifyRequestSchema", () => {
  it("rejects challengeId が UUID でない", () => {
    expect(
      passkeyVerifyRequestSchema.safeParse({
        challengeId: "not-a-uuid",
        response: {
          id: "abc",
          rawId: "abc",
          type: "public-key",
          response: {},
        },
      }).success,
    ).toBe(false);
  });
});
