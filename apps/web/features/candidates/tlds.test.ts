import { describe, expect, it } from "vitest";
import {
  DEFAULT_TLDS,
  isAllTlds,
  parseSearchQuery,
  SUPPORTED_TLDS,
} from "./tlds";

/**
 * 対応 TLD の正は `@dopamin/shared` の `REGISTRY_TLDS`（docs/requirements.md §11.2）。
 * ここがずれると実在しない TLD をレジストリに投げてしまうので、件数と代表値で固定する。
 */

/** `toContain` に未対応 TLD を渡せるよう、リテラル union ではなく string[] として見る。 */
const tlds: readonly string[] = SUPPORTED_TLDS;

describe("SUPPORTED_TLDS", () => {
  it("レジストリの対応 TLD と同じ 22 種で重複が無い", () => {
    expect(tlds).toHaveLength(22);
    expect(new Set(tlds).size).toBe(22);
  });

  it("kitaqsign / kitaqnic の TLD を含む", () => {
    // kitaqsign
    expect(tlds).toContain("com");
    // kitaqnic
    expect(tlds).toContain("xyz");
    expect(tlds).toContain("website");
    expect(tlds).toContain("art");
  });

  it("どちらのレジストリにも無い TLD は含まない", () => {
    expect(tlds).not.toContain("dev");
    expect(tlds).not.toContain("app");
  });
});

describe("DEFAULT_TLDS", () => {
  it("既定は全対応 TLD（ui-screens S-20 / S-24）", () => {
    expect(DEFAULT_TLDS).toEqual(tlds);
    expect(isAllTlds(DEFAULT_TLDS)).toBe(true);
  });

  it("絞り込むと isAllTlds は false になる", () => {
    expect(isAllTlds(["com"])).toBe(false);
    expect(isAllTlds([])).toBe(false);
  });
});

describe("parseSearchQuery", () => {
  it("`.` を含まない入力は SLD として扱う", () => {
    expect(parseSearchQuery(" takutaku ")).toEqual({
      ok: true,
      query: { kind: "sld", sld: "takutaku" },
    });
  });

  it("`.` を含む入力は FQDN として扱う", () => {
    expect(parseSearchQuery("takutaku.com")).toEqual({
      ok: true,
      query: { kind: "fqdn", name: "takutaku.com" },
    });
  });

  it("不正な入力はレジストリに送らず message を返す", () => {
    expect(parseSearchQuery("-bad-").ok).toBe(false);
    expect(parseSearchQuery("").ok).toBe(false);
  });
});
