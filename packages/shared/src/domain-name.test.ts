import { describe, expect, it } from "vitest";
import {
  domainNameSchema,
  hostNameSchema,
  sldSchema,
  splitDomainName,
} from "./domain-name";

describe("domainNameSchema（RFC 1035, AC-03-3）", () => {
  it.each(["example.com", "a1.xyz", "foo-bar.online", "a.b.com"])(
    "%s は有効",
    (name) => {
      expect(domainNameSchema.safeParse(name).success).toBe(true);
    },
  );

  it("大文字は小文字に正規化される", () => {
    expect(domainNameSchema.parse("Example.COM")).toBe("example.com");
  });

  it.each([
    ["TLD なし", "example"],
    ["先頭ハイフン", "-example.com"],
    ["末尾ハイフン", "example-.com"],
    ["不正文字", "exa_mple.com"],
    ["空ラベル", "example..com"],
    ["ラベル 64 文字", `${"a".repeat(64)}.com`],
    ["空文字", ""],
  ])("%s（%s）は無効", (_label, name) => {
    expect(domainNameSchema.safeParse(name).success).toBe(false);
  });

  it("全体 253 文字を超えると無効", () => {
    const long = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.com`;
    expect(long.length).toBeGreaterThan(253);
    expect(domainNameSchema.safeParse(long).success).toBe(false);
  });
});

describe("sldSchema", () => {
  it("有効な SLD を通す", () => {
    expect(sldSchema.parse("Takutaku")).toBe("takutaku");
  });
  it.each(["-a", "a-", "a b", ""])("%s は無効", (sld) => {
    expect(sldSchema.safeParse(sld).success).toBe(false);
  });
});

describe("hostNameSchema", () => {
  it("FQDN を通す", () => {
    expect(hostNameSchema.parse("NS1.Example.com")).toBe("ns1.example.com");
  });
  it("単一ラベルは無効", () => {
    expect(hostNameSchema.safeParse("localhost").success).toBe(false);
  });
});

describe("splitDomainName", () => {
  it("SLD / TLD に分割する", () => {
    expect(splitDomainName("takutaku.com")).toEqual({
      sld: "takutaku",
      tld: "com",
    });
    expect(splitDomainName("a.b.xyz")).toEqual({ sld: "a.b", tld: "xyz" });
  });
});
