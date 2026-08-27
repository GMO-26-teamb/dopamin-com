import { describe, expect, it } from "vitest";
import {
  REGISTRY_TLDS,
  registryIdForDomain,
  registryIdForTld,
  SUPPORTED_TLDS,
} from "./routing";

describe("TLD ルーティング（docs/requirements.md §11.2）", () => {
  it("kitaqsign の 2 TLD が引ける（8/27 の .org / .info 移管後）", () => {
    for (const tld of ["com", "net"]) {
      expect(registryIdForTld(tld)).toBe("kitaqsign");
    }
  });

  it("kitaqnic の 20 TLD（.org / .info 含む）が引ける", () => {
    expect(REGISTRY_TLDS.kitaqnic).toContain("org");
    expect(REGISTRY_TLDS.kitaqnic).toContain("info");
    for (const tld of REGISTRY_TLDS.kitaqnic) {
      expect(registryIdForTld(tld)).toBe("kitaqnic");
    }
  });

  it("合計 22 TLD で重複が無い", () => {
    expect(SUPPORTED_TLDS).toHaveLength(22);
    expect(new Set(SUPPORTED_TLDS).size).toBe(22);
  });

  it("ドット付き・大文字も正規化して引ける", () => {
    expect(registryIdForTld(".com")).toBe("kitaqsign");
    expect(registryIdForTld("XYZ")).toBe("kitaqnic");
  });

  it("未対応 TLD（.jp 含む）は null", () => {
    expect(registryIdForTld("jp")).toBeNull();
    expect(registryIdForTld("dev")).toBeNull();
  });

  it("FQDN からレジストリを引ける", () => {
    expect(registryIdForDomain("takutaku.com")).toBe("kitaqsign");
    expect(registryIdForDomain("takutaku.xyz")).toBe("kitaqnic");
    expect(registryIdForDomain("takutaku.jp")).toBeNull();
  });
});
