// ============================================================
// 既定コーパス (Tranco + curated) の統合と、§10.4 ワイヤ形式への写像の検証。
// スコアリング自体の回帰は uniqueness.test.ts / 実コーパスでの傾向監査は
// docs/specs/uniqueness/AUDIT_TRANCO.md を参照。
// ============================================================
import { describe, expect, it } from "vitest";
import { domainUniquenessSchema, toDomainUniqueness } from "../api";
import { uniquenessLabel } from "../uniqueness";
import { TRANCO_ENTRIES, TRANCO_META } from "./corpusTranco";
import {
  buildDefaultCorpusEntries,
  DEFAULT_CORPUS_VERSION,
  getDefaultPreparedCorpus,
} from "./defaultCorpus";
import { uniquenessResultSchema } from "./types";
import { scoreDistinctiveness, uniquenessBand } from "./uniqueness";

describe("既定コーパスの統合 (Tranco + curated)", () => {
  const entries = buildDefaultCorpusEntries();

  it("重複なし・全SLDが形式に適合・十分な規模がある", () => {
    const names = entries.map((e) => e.name);
    expect(new Set(names).size).toBe(entries.length);
    expect(names.every((n) => /^[a-z0-9-]{1,63}$/.test(n))).toBe(true);
    expect(entries.length).toBeGreaterThan(8000);
  });

  it("tranco 層は rank 付き・google が rank 1", () => {
    const google = entries.find((e) => e.name === "google");
    expect(google).toMatchObject({ tier: "tranco", rank: 1 });
    expect(
      entries.every((e) => e.tier !== "tranco" || (e.rank ?? 0) >= 1),
    ).toBe(true);
  });

  it("重複名は popularity の高い方を採用する (rakuten は curated-jp が勝つ)", () => {
    // rakuten は Tranco にも現れるが rank による popularity < popJp(0.90)
    expect(entries.find((e) => e.name === "rakuten")).toMatchObject({
      tier: "jp",
    });
    expect(entries.find((e) => e.name === "slack")).toMatchObject({
      tier: "tech",
    });
  });

  it("TRANCO_META が出典 (リストID・取得日・checksum・件数) を持つ", () => {
    expect(TRANCO_META.listId).toBe("74V4X");
    expect(TRANCO_META.retrievedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(TRANCO_META.inputSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(TRANCO_META.entryCount).toBe(TRANCO_ENTRIES.length);
  });

  it("corpusVersion にリストIDと取得日が入る", () => {
    expect(DEFAULT_CORPUS_VERSION).toBe(
      `tranco-${TRANCO_META.listId}-${TRANCO_META.retrievedDate}-top10k+curated-v1`,
    );
  });

  it("getDefaultPreparedCorpus はメモ化され、version を転記する", () => {
    const a = getDefaultPreparedCorpus();
    expect(getDefaultPreparedCorpus()).toBe(a);
    expect(a.version).toBe(DEFAULT_CORPUS_VERSION);
  });
});

describe("実コーパスでのスコアリング (スポットチェック)", () => {
  it("有名名の typo は low 帯・造語は high 帯になる", () => {
    const corpus = getDefaultPreparedCorpus();
    const typo = scoreDistinctiveness("googel", corpus);
    expect(uniquenessResultSchema.safeParse(typo).success).toBe(true);
    expect(uniquenessBand(typo.score)).toBe("low");
    expect(typo.closestMatches[0]?.name).toBe("google");
    expect(typo.corpusVersion).toBe(DEFAULT_CORPUS_VERSION);

    expect(scoreDistinctiveness("google", corpus).score).toBeLessThan(40);
    expect(uniquenessBand(scoreDistinctiveness("zufemira", corpus).score)).toBe(
      "high",
    );
  }, 60_000);
});

describe("toDomainUniqueness (§10.4 ワイヤ形式への写像)", () => {
  it("スキーマに適合し、label はスコアの帯と一致し、similarity は小数2桁", () => {
    const corpus = getDefaultPreparedCorpus();
    for (const q of ["googel", "zufemira", "qq"]) {
      const wire = toDomainUniqueness(scoreDistinctiveness(q, corpus));
      expect(domainUniquenessSchema.safeParse(wire).success).toBe(true);
      expect(wire.label).toBe(uniquenessLabel(wire.score));
      expect(wire.topSimilar.length).toBeLessThanOrEqual(3);
      for (const t of wire.topSimilar) {
        expect(Number.isInteger(Math.round(t.similarity * 100))).toBe(true);
        expect(
          Math.abs(t.similarity * 100 - Math.round(t.similarity * 100)),
        ).toBeLessThan(1e-9);
      }
    }
    // 短名は confidence: low がワイヤ形式へ伝わる
    const short = toDomainUniqueness(
      scoreDistinctiveness("qq", getDefaultPreparedCorpus()),
    );
    expect(short.confidence).toBe("low");
  }, 60_000);
});
