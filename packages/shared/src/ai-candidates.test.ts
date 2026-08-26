import { describe, expect, it } from "vitest";
import {
  DOMAIN_CANDIDATE_COUNT,
  domainCandidateSchema,
  domainCandidatesOutputSchema,
  domainCandidatesRequestSchema,
  excludeKey,
} from "./ai-candidates";

/** AI ドメイン候補生成の契約（docs/requirements.md FR-04 / §13.2）。 */

describe("domainCandidatesRequestSchema", () => {
  it("nickname だけで通り、前後の空白は落ちる", () => {
    const parsed = domainCandidatesRequestSchema.parse({
      nickname: "  たくたく  ",
    });
    expect(parsed).toEqual({ nickname: "たくたく" });
  });

  it("nickname は必須で、空文字は通らない", () => {
    expect(domainCandidatesRequestSchema.safeParse({}).success).toBe(false);
    expect(
      domainCandidatesRequestSchema.safeParse({ nickname: "   " }).success,
    ).toBe(false);
  });

  it("tlds は小文字化され、22 件を超えると弾かれる", () => {
    expect(
      domainCandidatesRequestSchema.parse({ nickname: "x", tlds: ["COM"] })
        .tlds,
    ).toEqual(["com"]);
    expect(
      domainCandidatesRequestSchema.safeParse({
        nickname: "x",
        tlds: Array.from({ length: 23 }, () => "com"),
      }).success,
    ).toBe(false);
  });

  it("exclude は 30 件まで", () => {
    expect(
      domainCandidatesRequestSchema.safeParse({
        nickname: "x",
        exclude: Array.from({ length: 31 }, (_, i) => `n${i}.com`),
      }).success,
    ).toBe(false);
  });
});

describe("domainCandidateSchema", () => {
  it("sld / tld を小文字に正規化する", () => {
    expect(
      domainCandidateSchema.parse({
        sld: "TakuTaku",
        tld: "COM",
        reason: "短い",
      }),
    ).toEqual({ sld: "takutaku", tld: "com", reason: "短い" });
  });

  it("RFC 1035 に反する SLD は弾く", () => {
    for (const sld of ["-bad", "bad-", "だめ", "a_b", "a.b"]) {
      expect(
        domainCandidateSchema.safeParse({ sld, tld: "com", reason: "x" })
          .success,
      ).toBe(false);
    }
  });

  it("理由は 40 字まで", () => {
    expect(
      domainCandidateSchema.safeParse({
        sld: "ok",
        tld: "com",
        reason: "あ".repeat(41),
      }).success,
    ).toBe(false);
  });
});

describe("domainCandidatesOutputSchema（AI の素の出力）", () => {
  it("不正な SLD が混ざっても応答全体は捨てない（値の妥当性はサービス側で見る）", () => {
    const parsed = domainCandidatesOutputSchema.safeParse({
      candidates: [
        { sld: "ok", tld: "com", reason: "良い" },
        { sld: "-bad", tld: "com", reason: "不正" },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("候補が 0 件、または多すぎる出力は弾く", () => {
    expect(
      domainCandidatesOutputSchema.safeParse({ candidates: [] }).success,
    ).toBe(false);
    expect(
      domainCandidatesOutputSchema.safeParse({
        candidates: Array.from(
          { length: DOMAIN_CANDIDATE_COUNT * 4 + 1 },
          (_, i) => ({ sld: `a${i}`, tld: "com", reason: "x" }),
        ),
      }).success,
    ).toBe(false);
  });
});

describe("excludeKey", () => {
  it("FQDN でも SLD でも同じキーになる", () => {
    expect(excludeKey("Dopamin.com")).toBe("dopamin");
    expect(excludeKey(" dopamin ")).toBe("dopamin");
    expect(excludeKey("dopamin.co.jp")).toBe("dopamin");
  });
});
