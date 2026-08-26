// ============================================================
// ドメイン独自性スコア: 純粋ロジック (DB / fs 非依存)
// 検証ハーネス uniq-lab/lib.mjs の設計A (scoreA) の最終版 v3.4-round2-final の移植。
// (ハーネス側の系譜: v3.2-round1 → v3.3-round2 → v3.4-round2-final。本ファイルは常に
//  ALGORITHM_VERSION が示す版と1対1対応する。JS版との等価性は5,635件全数一致で検証)
// 移植方針:
//  - プレフィルタ1 (文字ヒストグラム上界スキップ) は移植 (等価性検証済み: 5,417件差異0)
//  - プレフィルタ2 (compactビュー2段階足切り compactSim<0.60) は等価性未検証のため移植しない
//    (移植時再検証: 全回帰クエリ1,620件でプレフィルタ2なし版とスコア差異0を確認済み)
// ============================================================
import type { PreparedCorpus, PreparedCorpusEntry } from "./corpus";
import type {
  ClosestMatch,
  Confidence,
  RiskLevel,
  UniquenessBand,
  UniquenessResult,
} from "./types";
import { getDefaultWordChecker, type WordChecker } from "./wordlist";

/** アルゴリズムバージョン (lib.mjs v3.4-round2-final のTS移植・プレフィルタ2なし)。 */
export const ALGORITHM_VERSION = "v3.4-r2-ts.1";

export const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

// ---------- 距離指標 ----------
export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (!la || !lb) return 0;
  const md = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const am = new Array<boolean>(la).fill(false);
  const bm = new Array<boolean>(lb).fill(false);
  let m = 0;
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - md);
    const hi = Math.min(i + md + 1, lb);
    for (let j = lo; j < hi; j++) {
      if (!bm[j] && a[i] === b[j]) {
        am[i] = bm[j] = true;
        m++;
        break;
      }
    }
  }
  if (!m) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < la; i++) {
    if (am[i]) {
      while (!bm[k]) k++;
      if (a[i] !== b[k]) t++;
      k++;
    }
  }
  t /= 2;
  return (m / la + m / lb + (m - t) / m) / 3;
}

export function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  let p = 0;
  const max = Math.min(4, a.length, b.length);
  while (p < max && a[p] === b[p]) p++;
  return j + p * 0.1 * (1 - j);
}

/** Damerau-Levenshtein (OSA) 距離 */
export function dlDist(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  // noUncheckedIndexedAccess 対応で行を局所変数に取り出す。`?? 0` / `?? []` の
  // フォールバックはインデックスが常に範囲内のため到達しない (アルゴリズムは従来と同一)
  const firstRow: number[] = [];
  for (let j = 0; j <= lb; j++) firstRow.push(j);
  const rows: number[][] = [firstRow];
  for (let i = 1; i <= la; i++) {
    const r = new Array<number>(lb + 1).fill(0);
    r[0] = i;
    rows.push(r);
  }
  for (let i = 1; i <= la; i++) {
    const cur = rows[i] ?? [];
    const up = rows[i - 1] ?? [];
    const up2 = rows[i - 2];
    for (let j = 1; j <= lb; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(
        (up[j] ?? 0) + 1,
        (cur[j - 1] ?? 0) + 1,
        (up[j - 1] ?? 0) + c,
      );
      if (up2 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, (up2[j - 2] ?? 0) + 1);
      }
      cur[j] = v;
    }
  }
  return rows[la]?.[lb] ?? 0;
}

/** 正規化 Damerau-Levenshtein 類似度 */
export const ndl = (a: string, b: string): number =>
  a.length || b.length ? 1 - dlDist(a, b) / Math.max(a.length, b.length) : 1;

/** 文字列ペアの類似度 = max(JW, 正規化DL) */
export const pairSim = (a: string, b: string): number =>
  Math.max(jaroWinkler(a, b), ndl(a, b));

// ---------- 正規化ビュー ----------
/** base: 小文字化 + NFKC のみ (構造を壊さない) */
export const normBase = (s: string): string =>
  s.normalize("NFKC").toLowerCase().trim();

/** compact: base + ハイフン・記号除去のみ (数字は除去しない: studio54問題対策) */
export const normCompact = (s: string): string =>
  normBase(s).replace(/[-_.]/g, "");

// visual: compact + leet変換 (数字→似た文字)。
// 「1」は l と i の両方になり得る (l1ne = line) ため、バリアントを複数生成して比較時にmaxを取る
const LEET_L: Readonly<Record<string, string>> = {
  "0": "o",
  "1": "l",
  "2": "z",
  "3": "e",
  "4": "a",
  "5": "s",
  "6": "b",
  "7": "t",
  "8": "b",
  "9": "g",
};
const LEET_I: Readonly<Record<string, string>> = { ...LEET_L, "1": "i" };
export const normVisual = (s: string): string =>
  normCompact(s).replace(/[0-9]/g, (c) => LEET_L[c] ?? c);
export const normVisualI = (s: string): string =>
  normCompact(s).replace(/[0-9]/g, (c) => LEET_I[c] ?? c);

// phonetic: compact + ローマ字揺れの畳み込み (leetは適用しない)
const PHONETIC_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/shi/g, "si"],
  [/chi/g, "ti"],
  [/tsu/g, "tu"],
  [/fu/g, "hu"],
  [/ji/g, "zi"],
  [/ph/g, "f"],
  [/ck/g, "k"],
  [/q/g, "k"],
  [/c(?=[aou])/g, "k"],
  [/c(?=[ei])/g, "s"],
  [/l/g, "r"],
  [/x/g, "ks"],
  [/ou/g, "o"],
  [/oo/g, "o"],
  [/uu/g, "u"],
  [/ee/g, "e"],
  [/aa/g, "a"],
];
export function normPhonetic(s: string): string {
  let t = normCompact(s);
  for (const [re, to] of PHONETIC_RULES) t = t.replace(re, to);
  // 連続同一文字の圧縮は4文字以上の文字列のみ
  if (t.length >= 4) t = t.replace(/(.)\1+/g, "$1");
  return t;
}

// ---------- パラメータ ----------
export interface UniquenessParams {
  wc: number;
  wv: number;
  wp: number;
  alpha: number;
  thH: number;
  thL: number;
  fH: number;
  fL: number;
  dBase: number;
  dSlope: number;
  cBase: number;
  cSlope: number;
  cRelief: number;
  cRemMax: number;
  cTypoPenalty: number;
  eBase: number;
  eSlope: number;
  e2Base: number;
  e2Slope: number;
  popJp: number;
  popTech: number;
  wordRelief: number;
  wordReliefMaxSim: number;
  /** true でプレフィルタ1を無効化 (等価性の検証・デバッグ用) */
  disablePrefilter?: boolean;
}

/** 設計A v3.4-round2-final の確定パラメータ (lib.mjs PARAMS_A と同一値)。 */
export const DEFAULT_PARAMS: UniquenessParams = {
  wc: 0.97,
  wv: 0.95,
  wp: 0.9,
  // thL/thH/alpha はミニグリッドの安定領域 (0.70-0.74 × 0.90-0.94 × 0.4-0.6) の中心値
  alpha: 0.5,
  thH: 0.92,
  thL: 0.72,
  fH: 0.98,
  fL: 0.85,
  dBase: 55,
  dSlope: 35,
  // 包含カーブ (未知接辞+有名名): pop=1で30点、pop=0で75点。
  // R2: 残り5〜10文字にも緩和付きで適用 (1文字超過ごとに+cRelief点)
  cBase: 75,
  cSlope: 45,
  cRelief: 5,
  cRemMax: 10,
  cTypoPenalty: 10,
  // 編集距離1カーブ: pop=1で20点、pop=0で55点
  eBase: 20,
  eSlope: 35,
  // R2: 編集距離2カーブ (8文字以上のみ)
  e2Base: 45,
  e2Slope: 30,
  popJp: 0.9,
  popTech: 0.85,
  // R2-3: 一般語免除。実在の一般語 (辞書) で weighted<0.95 なら、
  // ルール系カーブを適用せず連続カーブに+wordReliefの緩和
  wordRelief: 15,
  wordReliefMaxSim: 0.95,
};

// ---------- 派生パターン ----------
export const AFFIXES: readonly string[] = [
  "get",
  "my",
  "try",
  "use",
  "app",
  "hq",
  "lab",
  "labs",
  "dev",
  "the",
  "go",
  "pro",
  "plus",
  "web",
  "online",
  "site",
  "official",
  "jp",
  "tokyo",
  // superamazon見逃し対策の強調prefix
  "super",
  "mega",
  "ultra",
  "neo",
  "mini",
  "smart",
  "easy",
  "best",
  "top",
  "new",
  // red-team R1: 日本語の敬称・呼称系とAI接頭辞
  "kun",
  "chan",
  "san",
  "sama",
  "ai",
];

export function derivedHit(candCompact: string, nameCompact: string): boolean {
  // 接辞リスト完全一致は誤爆リスクが低いため3文字名も対象(getdmm等)
  if (nameCompact.length < 3) return false;
  for (const af of AFFIXES) {
    if (candCompact === af + nameCompact) return true;
    if (candCompact === nameCompact + af) return true;
  }
  // 「有名名 + 数字(1-4桁)」「数字 + 有名名」は派生として扱う (note54, suumo55)
  if (
    /^\d{1,4}$/.test(candCompact.replace(nameCompact, "")) &&
    (candCompact.startsWith(nameCompact) || candCompact.endsWith(nameCompact))
  ) {
    return true;
  }
  return false;
}

// ---------- コーパス前処理で使うヘルパ ----------
/** 文字ヒストグラム (a-z0-9)。プレフィルタの類似度上界計算に使う */
export function charHist(s: string): Int16Array {
  const h = new Int16Array(36);
  for (const c of s) {
    const code = c.charCodeAt(0);
    // インデックスは常に 0..35 の範囲内 (noUncheckedIndexedAccess 対応の ?? 0 は到達しない)
    if (code >= 97 && code <= 122) h[code - 97] = (h[code - 97] ?? 0) + 1;
    else if (code >= 48 && code <= 57)
      h[26 + code - 48] = (h[26 + code - 48] ?? 0) + 1;
  }
  return h;
}

export function commonCount(h1: Int16Array, h2: Int16Array): number {
  let m = 0;
  for (let i = 0; i < 36; i++) m += Math.min(h1[i] ?? 0, h2[i] ?? 0);
  return m;
}

// ---------- 候補前処理 ----------
export interface PreparedCandidate {
  raw: string;
  vBase: string;
  vCompact: string;
  vVisual: string;
  vVisualI: string;
  vPhonetic: string;
}

export function prepCandidate(q: string): PreparedCandidate {
  return {
    raw: q,
    vBase: normBase(q),
    vCompact: normCompact(q),
    vVisual: normVisual(q),
    vVisualI: normVisualI(q),
    vPhonetic: normPhonetic(q),
  };
}

interface ViewSims {
  base: number;
  compact: number;
  visual: number;
  phonetic: number;
}

/** 候補1件 vs コーパス1件の「重み付きlexical」+ 生ビュー類似 */
function lexicalAgainst(
  cand: PreparedCandidate,
  entry: PreparedCorpusEntry,
  P: UniquenessParams,
  shortMode: boolean,
): { sims: ViewSims; weighted: number } {
  const sims: ViewSims = {
    base: pairSim(cand.vBase, entry.vBase),
    compact: shortMode ? 0 : pairSim(cand.vCompact, entry.vCompact),
    visual: shortMode
      ? 0
      : Math.max(
          pairSim(cand.vVisual, entry.vVisual),
          pairSim(cand.vVisualI, entry.vVisualI),
        ),
    phonetic: shortMode ? 0 : pairSim(cand.vPhonetic, entry.vPhonetic),
  };
  const weighted = Math.max(
    sims.base,
    sims.compact * P.wc,
    sims.visual * P.wv,
    sims.phonetic * P.wp,
  );
  return { sims, weighted };
}

// ---------- バンド / リスク ----------
/** 検証ハーネスの band() と同一区分 (gold の expect ラベルに対応)。 */
export const uniquenessBand = (score: number): UniquenessBand =>
  score >= 70 ? "high" : score >= 40 ? "mid" : "low";

/** リスクレベル = 独自性バンドの逆向き。 */
export const riskLevelOf = (score: number): RiskLevel =>
  score >= 70 ? "low" : score >= 40 ? "medium" : "high";

// ---------- スコアリング本体 (設計A) ----------
export interface ScoreOptions {
  params?: UniquenessParams;
  /** 一般語判定器。省略時はシードリストのデフォルト判定器 */
  wordChecker?: WordChecker;
}

interface ScoreRow {
  name: string;
  si: number;
  weighted: number;
  sims: ViewSims | null;
  pop: number;
  curve: string;
  derived: boolean;
  skipped?: boolean;
}

/**
 * 候補名 q のドメイン独自性スコア (0=紛らわしい 〜 100=独自) を計算する。
 * 純粋関数: prepareCorpus 済みのコーパスを受け取り、fs / DB には触れない。
 */
export function scoreDistinctiveness(
  q: string,
  corpus: PreparedCorpus,
  options: ScoreOptions = {},
): UniquenessResult {
  const P = options.params ?? DEFAULT_PARAMS;
  // 注: 同梱75,150語辞書のSetはモジュール単位で1回だけ構築される (getDefaultWordChecker がメモ化)
  const wordChecker = options.wordChecker ?? getDefaultWordChecker();
  const cand = prepCandidate(q);
  // 短名判定はcompact(記号除去後)長: ハイフン挿入による回避を防ぐ
  const shortMode = cand.vCompact.length <= 3;
  const isWord = wordChecker.isCommonWord(cand.vBase);
  const candHist = charHist(cand.vVisualI);
  const candLen = cand.vVisualI.length;
  const rows: ScoreRow[] = [];

  for (const e of corpus.entries) {
    // ---- プレフィルタ1 (結果不変の上界スキップ / 等価性検証済み) ----
    // 共通文字数から Jaro-Winkler と正規化DL の上界を計算し、
    // どのカーブにも寄与し得ないエントリの本計算を省く
    let rulePossible = true;
    if (!P.disablePrefilter && !shortMode) {
      const eLen = e.vVisualI.length;
      const common = commonCount(candHist, e.hist);
      const maxLen = Math.max(candLen, eLen, 1);
      const jaroBound =
        common === 0
          ? 0
          : (common / Math.max(candLen, 1) + common / Math.max(eLen, 1) + 1) /
            3;
      const pairBound = Math.max(0.6 * jaroBound + 0.4, common / maxLen) + 0.05;
      const lenDiff = candLen - eLen;
      rulePossible =
        lenDiff >= -2 &&
        lenDiff <= Math.max(P.cRemMax, 4) &&
        common >= eLen - 2;
      if (pairBound < P.thL && !rulePossible) {
        rows.push({
          name: e.name,
          si: 100,
          weighted: 0,
          sims: null,
          pop: e.pop,
          curve: "popularity",
          derived: false,
          skipped: true,
        });
        continue;
      }
    }

    // ※ 検証版のプレフィルタ2 (compactSim<0.60 の2段階足切り) は等価性未検証のため
    //    移植していない。常に全ビューを計算する。
    const { sims, weighted } = lexicalAgainst(cand, e, P, shortMode);

    // 有名度カーブ / 純類似 floor
    const sPop =
      100 *
      clamp01(
        (P.thH - weighted * (P.alpha + (1 - P.alpha) * e.pop)) /
          (P.thH - P.thL),
      );
    const sFloor = 100 * clamp01((P.fH - weighted) / (P.fH - P.fL));

    // 派生カーブ (leet併用攻撃対策で visual ビューでも判定)
    let sDerived = Infinity;
    const dHit =
      !shortMode &&
      (derivedHit(cand.vCompact, e.vCompact) ||
        derivedHit(cand.vVisual, e.vVisual) ||
        derivedHit(cand.vVisualI, e.vVisualI));
    if (dHit) sDerived = P.dBase - P.dSlope * e.pop;

    // 包含カーブ (未知の接辞+有名名対策)。有名名(5文字以上)を丸ごと含み残りが1〜cRemMax文字
    let sContain = Infinity;
    let cHit = false;
    if (!shortMode && e.vCompact.length >= 5) {
      let cRem = 0;
      const viewPairs: ReadonlyArray<readonly [string, string]> = [
        [cand.vCompact, e.vCompact],
        [cand.vVisual, e.vVisual],
        [cand.vVisualI, e.vVisualI],
      ];
      for (const [cv, ev] of viewPairs) {
        const rem = cv.length - ev.length;
        if (rem >= 1 && rem <= P.cRemMax && cv.includes(ev)) {
          cHit = true;
          cRem = rem;
          break;
        }
      }
      // 残りが4文字を超える分は1文字ごとに+cRelief点 (付加が長いほど独立した名前に近づく)
      if (cHit)
        sContain =
          P.cBase - P.cSlope * e.pop + P.cRelief * Math.max(0, cRem - 4);
      // 近似包含 (typo入りの有名名を内包: getgoogel等)。
      // 内部typo分は+cTypoPenaltyで弱い証拠として扱う
      if (
        !cHit &&
        e.vCompact.length >= 5 &&
        commonCount(candHist, e.hist) >= e.vVisualI.length - 1
      ) {
        outer: for (const [cv, ev] of viewPairs) {
          const rem = cv.length - ev.length;
          if (rem >= 1 && rem <= P.cRemMax) {
            for (let i = 0; i + ev.length <= cv.length; i++) {
              if (dlDist(cv.slice(i, i + ev.length), ev) <= 1) {
                sContain =
                  P.cBase -
                  P.cSlope * e.pop +
                  P.cRelief * Math.max(0, rem - 4) +
                  P.cTypoPenalty;
                cHit = true;
                break outer;
              }
            }
          }
        }
      }
    }

    // 編集距離カーブ (kiktok問題: 先頭置換はJW/floorをすり抜けるため絶対距離で防ぐ)
    let sEdit = Infinity;
    let editKind: "edit1" | "edit2" = "edit1";
    if (!shortMode && cand.vBase.length >= 4) {
      const dist = Math.min(
        dlDist(cand.vBase, e.vBase),
        dlDist(cand.vVisual, e.vVisual),
        dlDist(cand.vVisualI, e.vVisualI),
      );
      if (dist <= 1) sEdit = P.eBase + P.eSlope * (1 - e.pop);
      // 距離2は相対距離が小さい長い名前 (8文字以上) のみ。短い名前はfloor/popularityに任せる
      else if (dist === 2 && Math.max(cand.vBase.length, e.vBase.length) >= 8) {
        sEdit = P.e2Base + P.e2Slope * (1 - e.pop);
        editKind = "edit2"; // 表示ラベルの正確性 (edit1と偽らない)
      }
    }

    // 一般語免除: 実在語はルール系カーブを外し、連続カーブに緩和を加える。
    // ただし極端な類似 (weighted >= wordReliefMaxSim) は免除しない (amazons等のtyposquat級)
    let si: number;
    let relief = 0;
    if (isWord && weighted < P.wordReliefMaxSim) {
      relief = P.wordRelief;
      si = Math.min(100, Math.min(sPop, sFloor) + relief);
    } else {
      si = Math.min(sPop, sFloor, sDerived, sContain, sEdit);
    }
    const curve = relief
      ? Math.min(sPop, sFloor) === sPop
        ? "popularity+word"
        : "floor+word"
      : si === sPop
        ? "popularity"
        : si === sFloor
          ? "floor"
          : si === sDerived
            ? "derived"
            : si === sContain
              ? "contain"
              : editKind;
    rows.push({
      name: e.name,
      si,
      weighted,
      sims,
      pop: e.pop,
      curve,
      derived: dHit,
    });
  }

  rows.sort((x, y) => x.si - y.si);
  const confidence: Confidence = shortMode ? "low" : "normal";
  const best = rows[0];
  if (best === undefined) {
    // 空コーパスは「比較対象なし = 最大独自」として扱う (本番では起こらない想定)
    return {
      score: 100,
      riskLevel: "low",
      confidence,
      closestMatches: [],
      algorithmVersion: ALGORITHM_VERSION,
      corpusVersion: corpus.version,
    };
  }
  const score = Math.round(Math.max(0, Math.min(100, best.si)));
  const closestMatches: ClosestMatch[] = rows.slice(0, 3).map((r) => ({
    name: r.name,
    score: r.si,
    similarity: r.weighted,
    curve: r.curve,
    popularity: r.pop,
  }));
  return {
    score,
    riskLevel: riskLevelOf(score),
    confidence,
    closestMatches,
    algorithmVersion: ALGORITHM_VERSION,
    corpusVersion: corpus.version,
  };
}
