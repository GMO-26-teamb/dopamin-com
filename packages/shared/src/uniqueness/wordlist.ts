// ============================================================
// 一般語辞書 (過剰検出の免除用)
// - hunspell ファイルには実行時依存しない。英語一般語リストは「生成済みリストを注入する」設計。
//   本ファイルはリスト読み込みインターフェース + ステミングロジックのみを持つ。
// - 同梱リスト commonWordsEn.ts は scripts/generate-common-words.mjs で生成する
//   (生成元・ライセンス・再生成コマンドは commonWordsEn.ts と同スクリプトの冒頭を参照)。
//   注意: 生成リストは必ず「検証時の hunspell 集合と同一かその部分集合」にすること。
//   部分集合であれば一般語免除 (+15点緩和) が検証時より広がることはなく、
//   red-team で確認した攻撃耐性の上界が保たれる (語を足すほど攻撃を通しやすくなる)。
// ============================================================

import { COMMON_WORDS_EN } from "./commonWordsEn";

/** 一般語判定インターフェース。scoreDistinctiveness に注入する。 */
export interface WordChecker {
  /** base 正規化済み (小文字・NFKC・trim) の文字列が実在の一般語か */
  isCommonWord(base: string): boolean;
}

// 日本語ローマ字の補完 (都市・地名・一般名詞・代表的な人名)。検証版 dict.mjs と同一。
export const DICT_JP: ReadonlySet<string> = new Set(
  `
tokyo osaka kyoto nagoya sapporo fukuoka sendai hiroshima yokohama kobe nara
kanazawa niigata okayama kumamoto kagoshima naha okinawa chiba saitama shizuoka
shinjuku shibuya ikebukuro ueno asakusa akihabara ginza roppongi odaiba kamakura
hakone nikko atami karuizawa takayama miyajima fujisan fuji
sakura sushi ramen udon soba tempura wasabi matcha bento onigiri mochi dango
takoyaki okonomiyaki yakitori karaage gyoza tonkatsu unagi sashimi miso shoyu
sake yuzu ichigo ringo mikan suika kaki daikon ninjin shiitake
haruka yuki hana mei ren sota haruto yuto minato riku kaito yamato ichika
himari akari aoi mio saki yui nao kei taro jiro hanako keiko sachiko michiko
kazuki tomoki naoki hideki hiroki daiki yuya shinya takuya tatsuya
`
    .trim()
    .split(/\s+/),
);

// hunspell の .dic は活用形を含まない (probing 等) ため軽ステミングで基底形を試す。
// 明らかな一般語で hunspell に欠けるものの最小限補完 (追記時は理由をコミットログに)。
export const DICT_EXTRA: ReadonlySet<string> = new Set([
  "denote",
  "connote",
  "emote",
]);

/**
 * 一般語判定器を作る。englishWords に同梱リスト (または任意のリスト) を注入する。
 * ステミングロジックは検証版 dict.mjs の isCommonWord と同一。
 */
export function createWordChecker(
  englishWords: Iterable<string>,
  options: { includeJapanese?: boolean; extraWords?: Iterable<string> } = {},
): WordChecker {
  const en = new Set(englishWords);
  const jp = options.includeJapanese === false ? new Set<string>() : DICT_JP;
  const extra = new Set(options.extraWords ?? DICT_EXTRA);
  const lookup = (w: string): boolean => en.has(w) || jp.has(w) || extra.has(w);

  return {
    isCommonWord(base: string): boolean {
      if (lookup(base)) return true;
      const cands: string[] = [];
      if (base.endsWith("es")) cands.push(base.slice(0, -2));
      if (base.endsWith("s")) cands.push(base.slice(0, -1));
      if (base.endsWith("ing"))
        cands.push(base.slice(0, -3), `${base.slice(0, -3)}e`);
      if (base.endsWith("ed"))
        cands.push(
          base.slice(0, -2),
          `${base.slice(0, -2)}e`,
          base.slice(0, -1),
        );
      if (base.endsWith("er")) cands.push(base.slice(0, -2), base.slice(0, -1));
      if (base.endsWith("ly")) cands.push(base.slice(0, -2));
      return cands.some((c) => c.length >= 3 && lookup(c));
    },
  };
}

// 同梱75,150語のSet構築は一度だけ行い、以後の全採点で再利用する (採点ごとの再構築は高コスト)。
let defaultChecker: WordChecker | undefined;

/** 同梱の生成済みリスト (commonWordsEn.ts) で作るデフォルト判定器。モジュール単位でメモ化される。 */
export function getDefaultWordChecker(): WordChecker {
  if (defaultChecker === undefined) {
    defaultChecker = createWordChecker(COMMON_WORDS_EN);
  }
  return defaultChecker;
}
