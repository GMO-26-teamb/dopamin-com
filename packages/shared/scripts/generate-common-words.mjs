#!/usr/bin/env node
// ============================================================
// src/uniqueness/commonWordsEn.ts の生成スクリプト
//
// 使い方 (packages/shared ディレクトリで):
//   node scripts/generate-common-words.mjs <path-to-en_US.dic> > src/uniqueness/commonWordsEn.ts
// 例 (Debian/Ubuntu, パッケージ hunspell-en-us インストール済み環境):
//   node scripts/generate-common-words.mjs /usr/share/hunspell/en_US.dic > src/uniqueness/commonWordsEn.ts
//
// 入力: hunspell 形式の .dic ファイル (1行目はエントリ数、以降は "語" または "語/活用フラグ")
// 検証済みの生成元 (コミット時点):
//   - Debian パッケージ hunspell-en-us 1:2020.12.07-2 (SCOWL 2020.12.07 ベース)
//   - 上流プロジェクト: SCOWL (Spell Checker Oriented Word Lists), Kevin Atkinson
//     http://wordlist.aspell.net/ (SourceForge: http://wordlist.sourceforge.net/)
//
// 抽出条件 (検証ハーネス uniq-lab/dict.mjs と同一。変更禁止):
//   各行の "/" より前を trim + 小文字化し、/^[a-z]{3,15}$/ にマッチする語のみ採用。
//   重複除去のうえ辞書順にソート (決定的な出力のため)。
//   条件を変えると red-team で検証した「一般語免除 (+15点)」の挙動が変わる。
//   別バージョンの辞書で再生成する場合は、単体テストと等価性検証を必ず再実行すること。
// ============================================================
import { readFileSync } from "node:fs";

const dicPath = process.argv[2];
if (!dicPath) {
  console.error(
    "usage: node scripts/generate-common-words.mjs <path-to-en_US.dic>",
  );
  process.exit(1);
}

const WORD_RE = /^[a-z]{3,15}$/;
const words = new Set();
for (const line of readFileSync(dicPath, "utf8").split("\n")) {
  const w = (line.split("/")[0] ?? "").trim().toLowerCase();
  if (WORD_RE.test(w)) words.add(w);
}
const sorted = [...words].sort();

const header = `// 自動生成ファイル — 手編集禁止。再生成は packages/shared で:
//   node scripts/generate-common-words.mjs <path-to-en_US.dic> > src/uniqueness/commonWordsEn.ts
// 生成元: hunspell en_US.dic — Debian パッケージ hunspell-en-us 1:2020.12.07-2 (SCOWL 2020.12.07 ベース)
//   上流: SCOWL (Spell Checker Oriented Word Lists) http://wordlist.aspell.net/
// 抽出条件: 各行の "/" 前を小文字化し /^[a-z]{3,15}$/ にマッチする語のみ・重複除去・辞書順ソート
//   (検証ハーネス uniq-lab/dict.mjs と同一条件。語数: ${sorted.length})
// ライセンス (SCOWL): 以下の著作権表示と許諾文の掲示を条件に、使用・複製・改変・配布・販売が許諾される。
//   Copyright 2000-2011 by Kevin Atkinson
//   Permission to use, copy, modify, distribute and sell these word lists, the associated
//   scripts, the output created from the scripts, and its documentation for any purpose is
//   hereby granted without fee, provided that the above copyright notice appears in all copies
//   and that both that copyright notice and this permission notice appear in supporting
//   documentation. Kevin Atkinson makes no representations about the suitability of this array
//   for any purpose. It is provided "as is" without express or implied warranty.
//   (構成語リストごとの完全なライセンス文は Debian の /usr/share/doc/hunspell-en-us/copyright を参照)
`;

// 出力形式は biome format 済みの形に合わせてある (biome check がそのまま通る)
process.stdout.write(
  `${header}export const COMMON_WORDS_EN: readonly string[] =\n  "${sorted.join(" ")}".split(\n    " ",\n  );\n`,
);
