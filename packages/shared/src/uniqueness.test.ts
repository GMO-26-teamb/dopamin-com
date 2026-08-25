import { describe, expect, it } from "vitest";
import { isDopaminNameservers } from "./constants";
import { rarityTier, uniquenessLabel } from "./uniqueness";

describe("uniquenessLabel", () => {
  it("70 以上は high", () => {
    expect(uniquenessLabel(70)).toBe("high");
  });

  it("40〜69 は medium", () => {
    expect(uniquenessLabel(69)).toBe("medium");
    expect(uniquenessLabel(40)).toBe("medium");
  });

  it("40 未満は low", () => {
    expect(uniquenessLabel(39)).toBe("low");
  });
});

describe("rarityTier", () => {
  it("high → SSR", () => {
    expect(rarityTier(82)).toBe("SSR");
  });

  it("medium → R", () => {
    expect(rarityTier(55)).toBe("R");
  });

  it("low → N", () => {
    expect(rarityTier(38)).toBe("N");
  });
});

describe("isDopaminNameservers", () => {
  it("大文字小文字・末尾ドットを無視して両方含めば true", () => {
    expect(
      isDopaminNameservers([
        "NS1.dopamin.ut42tech.com.",
        "ns2.dopamin.ut42tech.com",
      ]),
    ).toBe(true);
  });

  it("片方だけでは false", () => {
    expect(isDopaminNameservers(["ns1.dopamin.ut42tech.com"])).toBe(false);
    expect(isDopaminNameservers(["ns2.dopamin.ut42tech.com"])).toBe(false);
  });
});
