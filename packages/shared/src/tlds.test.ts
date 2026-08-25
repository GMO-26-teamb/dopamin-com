import { describe, expect, it } from "vitest";
import {
  isSupportedTld,
  REGISTRY_TLDS,
  registryIdForDomain,
  registryIdForTld,
  SUPPORTED_TLDS,
} from "./tlds";

describe("対応 TLD 一覧（docs/requirements.md §11.2）", () => {
  it("合計 22 TLD で重複が無い", () => {
    expect(SUPPORTED_TLDS).toHaveLength(22);
    expect(new Set(SUPPORTED_TLDS).size).toBe(22);
  });

  it("kitaqsign 4 / kitaqnic 18 の内訳になっている", () => {
    expect(REGISTRY_TLDS.kitaqsign).toHaveLength(4);
    expect(REGISTRY_TLDS.kitaqnic).toHaveLength(18);
  });
});

describe("registryIdForTld", () => {
  it("kitaqsign の TLD を引ける", () => {
    expect(registryIdForTld("com")).toBe("kitaqsign");
  });

  it("kitaqnic の TLD を引ける", () => {
    expect(registryIdForTld("xyz")).toBe("kitaqnic");
  });

  it("ドット付き・大文字も正規化して引ける", () => {
    expect(registryIdForTld(".org")).toBe("kitaqsign");
    expect(registryIdForTld("CEO")).toBe("kitaqnic");
  });

  it("未対応 TLD は null", () => {
    expect(registryIdForTld("jp")).toBeNull();
  });
});

describe("isSupportedTld", () => {
  it("対応 TLD は true、未対応 TLD は false", () => {
    expect(isSupportedTld("com")).toBe(true);
    expect(isSupportedTld("xyz")).toBe(true);
    expect(isSupportedTld("dev")).toBe(false);
  });

  it("すべての SUPPORTED_TLDS が true になる", () => {
    expect(SUPPORTED_TLDS.every(isSupportedTld)).toBe(true);
  });
});

describe("registryIdForDomain", () => {
  it("FQDN からレジストリを引ける", () => {
    expect(registryIdForDomain("takutaku.com")).toBe("kitaqsign");
    expect(registryIdForDomain("takutaku.xyz")).toBe("kitaqnic");
    expect(registryIdForDomain("takutaku.jp")).toBeNull();
  });
});
