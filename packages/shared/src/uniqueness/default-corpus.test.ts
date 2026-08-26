// ============================================================
// 既定コーパス (Tranco + curated) の統合と、§10.4 ワイヤ形式への写像の検証。
// スコアリング自体の回帰は uniqueness.test.ts / 実コーパスでの傾向監査は
// docs/specs/uniqueness/AUDIT_TRANCO.md を参照。
// ============================================================
import { describe, expect, it } from "vitest";
import { isExcludedName } from "../../scripts/corpus-denylist.mjs";
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

describe("コーパスの健全性 (アダルト・海賊版サイトの除外)", () => {
  // topSimilar の名前は候補カード・登録ダイアログ・ランディングにそのまま描画される
  // （FR-05 / §10.4）。Tranco 上位1万件に含まれる成人向け・海賊版サイト名が
  // 「最も近い既存名」として出ないことを回帰で守る。
  it("denylist に当たる名前がコーパスに残っていない", () => {
    const leaked = buildDefaultCorpusEntries()
      .map((e) => e.name)
      .filter((name) => isExcludedName(name));
    expect(leaked).toEqual([]);
  });

  it("誤検出させたくない正規の名前は残っている", () => {
    const names = new Set(buildDefaultCorpusEntries().map((e) => e.name));
    for (const keep of [
      "google-analytics",
      "java",
      "analog",
      "bittorrent",
      "myanimelist",
      "k-manga",
      "jeuxvideo",
      "nflxvideo",
    ]) {
      expect(names.has(keep), `${keep} が誤って除外されている`).toBe(true);
    }
  });

  it("日本向けに打たれやすい語の topSimilar が健全である", () => {
    const corpus = getDefaultPreparedCorpus();
    for (const q of ["anime", "manga", "otaku", "doujin", "rule", "hanami"]) {
      const names = toDomainUniqueness(
        scoreDistinctiveness(q, corpus),
      ).topSimilar.map((t) => t.name);
      for (const name of names) {
        expect(isExcludedName(name), `${q} → ${name}`).toBe(false);
      }
    }
  }, 60_000);
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

  it("topSimilar は類似度の降順で、類似度 0 の行を含まない", () => {
    const corpus = getDefaultPreparedCorpus();
    // 独自性の高い名前ほど「全件が同点」になり、未計算の similarity 0 が
    // 先頭に出やすい（コーパス先頭の google / cloudflare / facebook）。
    for (const q of ["zufemira", "googel", "takutaku", "dopamin"]) {
      const { topSimilar } = toDomainUniqueness(
        scoreDistinctiveness(q, corpus),
      );
      expect(topSimilar.every((t) => t.similarity > 0)).toBe(true);
      const sims = topSimilar.map((t) => t.similarity);
      expect(sims).toEqual([...sims].sort((a, b) => b - a));
    }
    // 最近傍が実在する場合は先頭がその名前になる
    expect(
      toDomainUniqueness(scoreDistinctiveness("gogle", corpus)).topSimilar[0]
        ?.name,
    ).toBe("google");
  }, 60_000);
});
