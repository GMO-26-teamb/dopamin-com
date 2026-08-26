// ============================================================
// 独自性スコア回帰テスト (vitest)
// 検証ハーネス uniq-lab/test.mjs の移植:
//   gold全件 + red-team攻撃回帰 (ATTACK_REGRESSION) + FA回帰 (FA_REGRESSION)
//   + propertyミニ (同一シードのLCG fuzz 1,500件) + コーパス完全一致
// 期待値は検証済みJS実装と同一。期待値の変更は禁止 (通らない場合は実装を直す)。
// ============================================================
import { describe, expect, it } from "vitest";
import { type CorpusEntry, prepareCorpus } from "./corpus";
import { uniquenessResultSchema } from "./types";
import {
  DEFAULT_PARAMS,
  scoreDistinctiveness,
  uniquenessBand,
} from "./uniqueness";
import { getDefaultWordChecker } from "./wordlist";

// 擬似コーパス (検証ハーネス corpus.mjs と同一。実コーパスは Tranco 1万件 + curated 600件)
const TEST_CORPUS: CorpusEntry[] = [
  { name: "google", tier: "tranco", rank: 1 },
  { name: "youtube", tier: "tranco", rank: 2 },
  { name: "facebook", tier: "tranco", rank: 3 },
  { name: "instagram", tier: "tranco", rank: 4 },
  { name: "twitter", tier: "tranco", rank: 5 },
  { name: "x", tier: "tranco", rank: 6 },
  { name: "amazon", tier: "tranco", rank: 7 },
  { name: "wikipedia", tier: "tranco", rank: 8 },
  { name: "yahoo", tier: "tranco", rank: 9 },
  { name: "whatsapp", tier: "tranco", rank: 10 },
  { name: "netflix", tier: "tranco", rank: 12 },
  { name: "tiktok", tier: "tranco", rank: 14 },
  { name: "reddit", tier: "tranco", rank: 16 },
  { name: "linkedin", tier: "tranco", rank: 18 },
  { name: "microsoft", tier: "tranco", rank: 20 },
  { name: "apple", tier: "tranco", rank: 22 },
  { name: "bing", tier: "tranco", rank: 26 },
  { name: "qq", tier: "tranco", rank: 30 },
  { name: "pinterest", tier: "tranco", rank: 32 },
  { name: "ebay", tier: "tranco", rank: 40 },
  { name: "twitch", tier: "tranco", rank: 45 },
  { name: "spotify", tier: "tranco", rank: 50 },
  { name: "zoom", tier: "tranco", rank: 60 },
  { name: "github", tier: "tranco", rank: 70 },
  { name: "adobe", tier: "tranco", rank: 75 },
  { name: "openai", tier: "tranco", rank: 80 },
  { name: "dropbox", tier: "tranco", rank: 85 },
  { name: "paypal", tier: "tranco", rank: 90 },
  { name: "salesforce", tier: "tranco", rank: 100 },
  { name: "shopify", tier: "tranco", rank: 120 },
  { name: "wordpress", tier: "tranco", rank: 130 },
  { name: "cloudflare", tier: "tranco", rank: 150 },
  { name: "vk", tier: "tranco", rank: 160 },
  { name: "tumblr", tier: "tranco", rank: 200 },
  { name: "quora", tier: "tranco", rank: 250 },
  { name: "medium", tier: "tranco", rank: 300 },
  { name: "canva", tier: "tranco", rank: 350 },
  { name: "duckduckgo", tier: "tranco", rank: 400 },
  { name: "roblox", tier: "tranco", rank: 450 },
  { name: "steam", tier: "tranco", rank: 500 },
  { name: "airbnb", tier: "tranco", rank: 1000 },
  { name: "booking", tier: "tranco", rank: 1100 },
  { name: "tripadvisor", tier: "tranco", rank: 1500 },
  { name: "imdb", tier: "tranco", rank: 1600 },
  { name: "coursera", tier: "tranco", rank: 2000 },
  { name: "udemy", tier: "tranco", rank: 2500 },
  { name: "gitlab", tier: "tranco", rank: 3000 },
  { name: "bitbucket", tier: "tranco", rank: 4000 },
  { name: "substack", tier: "tranco", rank: 5000 },
  { name: "lemonsqueezy", tier: "tranco", rank: 8000 },
  { name: "plausible", tier: "tranco", rank: 9000 },
  { name: "rakuten", tier: "jp" },
  { name: "mercari", tier: "jp" },
  { name: "zozo", tier: "jp" },
  { name: "paypay", tier: "jp" },
  { name: "line", tier: "jp" },
  { name: "cookpad", tier: "jp" },
  { name: "pixiv", tier: "jp" },
  { name: "niconico", tier: "jp" },
  { name: "dmm", tier: "jp" },
  { name: "suumo", tier: "jp" },
  { name: "tabelog", tier: "jp" },
  { name: "hotpepper", tier: "jp" },
  { name: "gurunavi", tier: "jp" },
  { name: "ameblo", tier: "jp" },
  { name: "hatena", tier: "jp" },
  { name: "qiita", tier: "jp" },
  { name: "zenn", tier: "jp" },
  { name: "note", tier: "jp" },
  { name: "minne", tier: "jp" },
  { name: "creema", tier: "jp" },
  { name: "wantedly", tier: "jp" },
  { name: "mixi", tier: "jp" },
  { name: "abema", tier: "jp" },
  { name: "tver", tier: "jp" },
  { name: "radiko", tier: "jp" },
  { name: "tsutaya", tier: "jp" },
  { name: "mitsubishi", tier: "jp" },
  { name: "nintendo", tier: "jp" },
  { name: "yodobashi", tier: "jp" },
  { name: "vercel", tier: "tech" },
  { name: "supabase", tier: "tech" },
  { name: "figma", tier: "tech" },
  { name: "notion", tier: "tech" },
  { name: "slack", tier: "tech" },
  { name: "discord", tier: "tech" },
  { name: "stripe", tier: "tech" },
  { name: "netlify", tier: "tech" },
  { name: "heroku", tier: "tech" },
  { name: "docker", tier: "tech" },
  { name: "react", tier: "tech" },
  { name: "nextjs", tier: "tech" },
  { name: "tailwind", tier: "tech" },
  { name: "prisma", tier: "tech" },
  { name: "deno", tier: "tech" },
  { name: "firebase", tier: "tech" },
  { name: "mongodb", tier: "tech" },
  { name: "redis", tier: "tech" },
  { name: "postman", tier: "tech" },
  { name: "jira", tier: "tech" },
  { name: "confluence", tier: "tech" },
  { name: "npm", tier: "tech" },
  { name: "vite", tier: "tech" },
  { name: "eslint", tier: "tech" },
  { name: "expo", tier: "tech" },
  { name: "storybook", tier: "tech" },
  { name: "flutter", tier: "tech" },
  { name: "kaggle", tier: "tech" },
  { name: "huggingface", tier: "tech" },
];

// 一般語判定器: シードリスト (検証時 hunspell 集合の部分集合) で構築
// 同梱の生成済みフルリスト(検証ハーネスと同一集合)で判定
const wordChecker = getDefaultWordChecker();
const corpus = prepareCorpus(TEST_CORPUS, { version: "test-fixture-v1" });
const score = (q: string) => scoreDistinctiveness(q, corpus, { wordChecker });

// ゴールドセット (バッチ1・人間レビュー済みラベル。boundary は soft 判定 20-80)
interface GoldCase {
  q: string;
  expect: "low" | "mid" | "high" | "ambiguous";
  boundary?: boolean;
}
const GOLD: GoldCase[] = [
  { q: "google", expect: "low" }, // exact: 世界最有名と完全一致
  { q: "amazon", expect: "low" }, // exact: 完全一致
  { q: "rakuten", expect: "low" }, // exact: 国内最有名と完全一致
  { q: "mercari", expect: "low" }, // exact: 完全一致
  { q: "vercel", expect: "low" }, // exact: tech有名と完全一致
  { q: "figma", expect: "low" }, // exact: 完全一致
  { q: "qq", expect: "low" }, // exact-short: 短い有名と完全一致
  { q: "note", expect: "low" }, // exact: 国内有名と完全一致(一般語でもサービスが実在)
  { q: "gogle", expect: "low" }, // typo: google-1文字
  { q: "goolge", expect: "low" }, // typo: google転置
  { q: "googel", expect: "low" }, // typo: google転置
  { q: "amazn", expect: "low" }, // typo: amazon-1文字
  { q: "amazonn", expect: "low" }, // typo: amazon+1文字
  { q: "amzon", expect: "low" }, // typo: amazon-1文字
  { q: "facebok", expect: "low" }, // typo: facebook-1文字
  { q: "faceboook", expect: "low" }, // typo: facebook+1文字
  { q: "instagam", expect: "low" }, // typo: instagram-1文字
  { q: "netflx", expect: "low" }, // typo: netflix-1文字
  { q: "youtub", expect: "low" }, // typo: youtube-1文字
  { q: "twiter", expect: "low" }, // typo: twitter-1文字
  { q: "mercri", expect: "low" }, // typo: mercari-1文字
  { q: "vercell", expect: "low" }, // typo: vercel+1文字
  { q: "notio", expect: "low" }, // typo: notion-1文字
  { q: "slak", expect: "low" }, // typo: slack-1文字(短め)
  { q: "githb", expect: "low" }, // typo: github-1文字
  { q: "gooogle", expect: "low" }, // typo: google+1文字(距離2級も拾いたい)
  { q: "supabse", expect: "low" }, // typo: supabase-1文字
  { q: "g00gle", expect: "low" }, // leet: 0→o でgoogle
  { q: "amaz0n", expect: "low" }, // leet: 0→o でamazon
  { q: "faceb00k", expect: "low" }, // leet: leet
  { q: "l1ne", expect: "low" }, // leet: 1→l でline
  { q: "t1ktok", expect: "low" }, // leet: leet
  { q: "m3rcari", expect: "low" }, // leet: 3→e でmercari
  { q: "racuten", expect: "low" }, // romaji: c→k でrakuten
  { q: "tutaya", expect: "low" }, // romaji: 訓令式tsutaya
  { q: "lakuten", expect: "low" }, // romaji: l→r でrakuten
  { q: "mitubisi", expect: "low" }, // romaji: 訓令式mitsubishi
  { q: "guglenavi", expect: "mid", boundary: true }, // romaji: gurunavi + google風。判断が割れそう
  { q: "getnotion", expect: "low" }, // derived: get+notion
  { q: "myfigma", expect: "low" }, // derived: my+figma
  { q: "vercelapp", expect: "low" }, // derived: vercel+app
  { q: "githubhq", expect: "low" }, // derived: github+hq
  { q: "trymercari", expect: "low" }, // derived: try+mercari
  { q: "usestripe", expect: "low" }, // derived: use+stripe
  { q: "thegoogle", expect: "low" }, // derived: the+google
  { q: "my-line", expect: "low" }, // derived-hyphen: ハイフン付きmy+line
  { q: "line-app", expect: "low" }, // derived-hyphen: line+app
  { q: "getzorufa", expect: "high" }, // derived-safe: 存在しない名前の派生は安全
  { q: "slackpro", expect: "low" }, // derived: slack+pro
  { q: "superamazon", expect: "low" }, // compound: 接辞リスト外prefix+amazon
  { q: "dropboxapp", expect: "low" }, // compound: dropbox+app(接辞リスト内)
  { q: "notionly", expect: "low" }, // compound: notion+ly 造語にも見える
  { q: "slacker", expect: "mid", boundary: true }, // compound: 実在英単語。slack+erでもある
  { q: "spotifyy", expect: "low" }, // typo: spotify+1文字
  { q: "spatify", expect: "low" }, // near: spotifyと2文字違い。判断が割れそう
  { q: "amazonia", expect: "mid", boundary: true }, // near: 実在地名。amazon+2文字
  { q: "instagrid", expect: "mid", boundary: true }, // near: insta系だがgridで差別化しているとも言える
  { q: "studio54", expect: "high" }, // digits: コーパスに類似名なし。数字は名前の一部
  { q: "note54", expect: "low" }, // digits: note(有名)+数字。判断を仰ぎたい
  { q: "suumo55", expect: "low" }, // digits: suumo+数字
  { q: "web-design-lab", expect: "high" }, // hyphen: 一般語の組合せ。特定サービスと紛らわしくない
  { q: "fd", expect: "high" }, // short: 2文字。何とも近くない
  { q: "xx", expect: "mid", boundary: true }, // short: x(有名)と1文字差
  { q: "zq", expect: "high" }, // short: qqと1文字差
  { q: "npm", expect: "low" }, // exact-short: 3文字有名と完全一致
  { q: "zorufa", expect: "high" }, // coinage: 造語
  { q: "kimeruno", expect: "high" }, // coinage: 造語
  { q: "plavory", expect: "high" }, // coinage: 造語
  { q: "mizukane", expect: "high" }, // coinage: 和風造語
  { q: "torikama", expect: "high" }, // coinage: 和風造語
  { q: "sunabiro", expect: "high" }, // coinage: 和風造語
  { q: "kemuriya", expect: "high" }, // coinage: 和風造語
  { q: "hoshigama", expect: "high" }, // coinage: 和風造語
  { q: "fuyunagi", expect: "high" }, // coinage: 和風造語
  { q: "sakumori", expect: "high" }, // coinage: 和風造語
  { q: "nokishita", expect: "high" }, // coinage: 和風造語
  { q: "orbique", expect: "high" }, // coinage: 欧風造語
  { q: "velmora", expect: "high" }, // coinage: 欧風造語
  { q: "quenzia", expect: "high" }, // coinage: 欧風造語
  { q: "drofell", expect: "high" }, // coinage: 欧風造語
  { q: "snorble", expect: "high" }, // coinage: 欧風造語
  { q: "taviko", expect: "high" }, // coinage: 造語
  { q: "murelin", expect: "high" }, // coinage: 造語
  { q: "wobura", expect: "high" }, // coinage: 造語
  { q: "entaku", expect: "high" }, // coinage: 一般語だが有名サービスなし
  { q: "dopamin", expect: "high" }, // coinage: 自分たちのプロダクト名。高スコアであってほしいが判定は正直に
  { q: "takutaku", expect: "high" }, // coinage: デモで使うニックネーム由来
  { q: "hirumeshi", expect: "high" }, // coinage: 一般語。有名サービスなし
  { q: "kazamidori", expect: "high" }, // coinage: 一般語。有名サービスなし
  { q: "yorimichi", expect: "high" }, // coinage: 一般語。有名サービスなし
];

describe("gold: レビュー済みゴールドセット全件", () => {
  for (const g of GOLD) {
    if (g.expect === "ambiguous") continue;
    if (g.boundary) {
      it(`${g.q} は boundary (20-80)`, () => {
        const r = score(g.q);
        expect(r.score).toBeGreaterThanOrEqual(20);
        expect(r.score).toBeLessThanOrEqual(80);
      });
    } else {
      it(`${g.q} は ${g.expect}`, () => {
        expect(uniquenessBand(score(g.q).score)).toBe(g.expect);
      });
    }
  }
});

// red-team で発見した攻撃ケースの回帰 (low/mid であること = 70未満)
const ATTACK_REGRESSION = [
  "kiktok",
  "kunamazon",
  "chaninstagram",
  "get1nstagram",
  "gettw1tter",
  "underwikipedia",
  "understripe",
  "onlypixivfy",
  "spotifywordpress",
  "ealesfoce",
  "ilinkein",
  "getgoogel",
  "superamazon",
  "note54",
  "getnetfl1x",
];
describe("attack: red-team攻撃の回帰", () => {
  for (const q of ATTACK_REGRESSION) {
    it(`${q} < 70`, () => {
      expect(score(q).score).toBeLessThan(70);
    });
  }
});

// FA側の回帰 (実在の一般語が 40 以上 = mid か high であること)
const FA_REGRESSION = [
  "life",
  "room",
  "nation",
  "notebook",
  "probing",
  "team",
  "witch",
  "adore",
  "pineapple",
  "denote",
];
describe("fa: 一般語の過剰検出回帰", () => {
  for (const q of FA_REGRESSION) {
    it(`${q} >= 40`, () => {
      expect(score(q).score).toBeGreaterThanOrEqual(40);
    });
  }
});

describe("property: fuzz 1,500件 + コーパス全件", () => {
  it("範囲・決定性・top整合・confidence (検証ハーネスと同一シード)", () => {
    let seed = 13579;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789-";
    for (let i = 0; i < 1500; i++) {
      let q = "";
      const len = 1 + Math.floor(rnd() * 14);
      for (let k = 0; k < len; k++)
        q += CHARS[Math.floor(rnd() * CHARS.length)];
      q = q.replace(/^-+|-+$/g, "") || "a";
      const r = score(q);
      // スコアは 0-100 の整数
      expect(Number.isInteger(r.score) && r.score >= 0 && r.score <= 100).toBe(
        true,
      );
      // 決定的
      expect(score(q).score).toBe(r.score);
      // 最近傍がスコアを決める / 近い順に並ぶ
      const m0 = r.closestMatches[0];
      const m1 = r.closestMatches[1];
      if (m0) {
        expect(Math.round(Math.max(0, Math.min(100, m0.score)))).toBe(r.score);
      }
      if (m0 && m1) {
        expect(m0.score).toBeLessThanOrEqual(m1.score);
      }
      // 仕様変更(2026-08-26): 短名判定はcompact(記号除去後)長。ハイフン挿入による回避を防ぐ
      const isShort =
        q.normalize("NFKC").toLowerCase().trim().replace(/[-_.]/g, "").length <=
        3;
      expect(r.confidence === "low").toBe(isShort);
    }
  });

  it("コーパス収載名そのものは常に low (<40)", () => {
    for (const e of TEST_CORPUS) {
      expect(score(e.name).score).toBeLessThan(40);
    }
  });
});

describe("結果スキーマ", () => {
  it("UniquenessResult が zod スキーマに適合する", () => {
    for (const q of ["google", "zorufa", "qq", "studio54"]) {
      const r = score(q);
      expect(() => uniquenessResultSchema.parse(r)).not.toThrow();
      expect(r.algorithmVersion).toBe("v3.4-r2-ts.1");
      expect(r.corpusVersion).toBe("test-fixture-v1");
      expect(r.closestMatches.length).toBeLessThanOrEqual(3);
    }
  });

  it("riskLevel は score の逆向きバンド", () => {
    const high = score("google"); // low score → high risk
    expect(high.riskLevel).toBe("high");
    const low = score("zorufa"); // high score → low risk
    expect(low.riskLevel).toBe("low");
  });
});

describe("プレフィルタ1の等価性 (スポットチェック)", () => {
  it("disablePrefilter でもスコアが変わらない", () => {
    const noPre = { ...DEFAULT_PARAMS, disablePrefilter: true };
    const queries = [
      ...GOLD.map((g) => g.q),
      ...ATTACK_REGRESSION,
      ...FA_REGRESSION,
    ];
    for (const q of queries) {
      const a = scoreDistinctiveness(q, corpus, { wordChecker }).score;
      const b = scoreDistinctiveness(q, corpus, {
        wordChecker,
        params: noPre,
      }).score;
      expect(b).toBe(a);
    }
  });
});
