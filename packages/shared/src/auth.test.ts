import { describe, expect, it } from "vitest";
import {
  displayNameSchema,
  passkeyNameSchema,
  passkeyRenameRequestSchema,
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

describe("passkeyNameSchema（FR-01 spec §3.4: displayName と同じ 1〜32 文字）", () => {
  it("accepts 1〜32 文字", () => {
    expect(passkeyNameSchema.parse("M")).toBe("M");
    expect(passkeyNameSchema.parse("あ".repeat(32))).toBe("あ".repeat(32));
  });

  it("rejects 空文字・33 文字・空白のみ", () => {
    expect(passkeyNameSchema.safeParse("").success).toBe(false);
    expect(passkeyNameSchema.safeParse("あ".repeat(33)).success).toBe(false);
    expect(passkeyNameSchema.safeParse("   ").success).toBe(false);
  });

  it("trims 前後の空白", () => {
    expect(passkeyNameSchema.parse("  仕事用 MacBook  ")).toBe(
      "仕事用 MacBook",
    );
  });
});

describe("passkeyRenameRequestSchema", () => {
  it("accepts { name }", () => {
    expect(passkeyRenameRequestSchema.parse({ name: "iPhone" })).toEqual({
      name: "iPhone",
    });
  });

  it("rejects name が無い・文字列でない", () => {
    expect(passkeyRenameRequestSchema.safeParse({}).success).toBe(false);
    expect(passkeyRenameRequestSchema.safeParse({ name: 1 }).success).toBe(
      false,
    );
  });
});
