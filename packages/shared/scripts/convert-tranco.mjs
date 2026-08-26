#!/usr/bin/env node
// ============================================================
// src/uniqueness/corpusTranco.ts の生成スクリプト (オフライン変換)
//
// 使い方 (packages/shared ディレクトリで):
//   node scripts/convert-tranco.mjs <path-to-tranco-csv> [--list-id=XXXXX] > src/uniqueness/corpusTranco.ts
//
// 入力: Tranco リスト CSV (各行 "rank,domain")。公式 https://tranco-list.eu/ の
//   top-1m.csv.zip を展開し、上位1万行を切り出したもの (例: head -10000)。
//   --list-id には https://tranco-list.eu/top-1m-id が返す永続リストIDを渡す
//   (引用・再現用。未指定時は入力CSVの sha256 先頭12桁で代替)。
//
// 変換内容:
//   1. SLD 抽出: 登録可能ドメインの公有サフィックス直前のラベルを取る。
//      2レベル公有サフィックス (co.uk 等) は「中間ラベル集合 × 2文字ccTLD」の
//      規則で判定する (入力1万件に現れた161種の組合せを全て網羅することを確認済み)。
//   2. 除外: .arpa / punycode (xn--) / /^[a-z0-9-]{1,63}$/ に合わないもの /
//      アダルト・海賊版サイト (scripts/corpus-denylist.mjs。topSimilar に名前が
//      そのまま描画されるため、スコア計算からも表示からも外す)
//   3. 重複除去: 同一SLDは最小 rank (最有名) を採用
//   4. 出典メタ (リストID・取得日・入力checksum・件数) を TRANCO_META に記録
//
// 注意: 抽出規則を変えたら packages/shared のテストと監査
// (docs/specs/uniqueness/AUDIT_TRANCO.md) を必ず再実行すること。
// ============================================================
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isExcludedName } from "./corpus-denylist.mjs";

const args = process.argv.slice(2);
const csvPath = args.find((a) => !a.startsWith("--"));
const listIdArg = args.find((a) => a.startsWith("--list-id="));
if (!csvPath) {
  console.error(
    "usage: node scripts/convert-tranco.mjs <path-to-tranco-csv> [--list-id=XXXXX]",
  );
  process.exit(1);
}

// 2レベル公有サフィックスの中間ラベル (入力1万件の全組合せを網羅)。
// 「最後のラベルが2文字ccTLD かつ 直前がこの集合」のとき2レベルをサフィックスと見なす
const SECOND_LEVEL_LABELS = new Set([
  "ac",
  "ad",
  "bet",
  "blog",
  "co",
  "com",
  "edu",
  "gob",
  "gouv",
  "gov",
  "gv",
  "in",
  "jus",
  "lg",
  "mil",
  "mus",
  "ne",
  "net",
  "nhs",
  "nic",
  "or",
  "org",
  "vlog",
  "go",
  "sch",
]);

const raw = readFileSync(csvPath);
const sha256 = createHash("sha256").update(raw).digest("hex");
const listId = listIdArg
  ? listIdArg.slice("--list-id=".length)
  : `sha-${sha256.slice(0, 12)}`;

const SLD_RE = /^[a-z0-9-]{1,63}$/;
const bySld = new Map(); // sld -> min rank
const dropped = { arpa: 0, punycode: 0, invalid: 0, denied: 0, dup: 0 };

for (const line of raw.toString("utf8").split("\n")) {
  const t = line.trim();
  if (!t) continue;
  const comma = t.indexOf(",");
  if (comma < 0) continue;
  const rank = Number(t.slice(0, comma));
  const domain = t
    .slice(comma + 1)
    .trim()
    .toLowerCase();
  if (!Number.isInteger(rank) || rank <= 0 || !domain) continue;
  const parts = domain.split(".");
  if (parts.length < 2) continue;
  const last = parts[parts.length - 1];
  if (last === "arpa") {
    dropped.arpa++;
    continue;
  }
  const middle = parts[parts.length - 2];
  const suffixLen =
    parts.length >= 3 && last.length === 2 && SECOND_LEVEL_LABELS.has(middle)
      ? 2
      : 1;
  const sldIndex = parts.length - suffixLen - 1;
  if (sldIndex < 0) continue;
  const sld = parts[sldIndex];
  if (sld.startsWith("xn--")) {
    dropped.punycode++;
    continue;
  }
  if (!SLD_RE.test(sld)) {
    dropped.invalid++;
    continue;
  }
  if (isExcludedName(sld)) {
    dropped.denied++;
    continue;
  }
  const prev = bySld.get(sld);
  if (prev === undefined || rank < prev) {
    if (prev !== undefined) dropped.dup++;
    bySld.set(sld, rank);
  } else {
    dropped.dup++;
  }
}

// rank 昇順で決定的に出力
const entries = [...bySld.entries()].sort((a, b) => a[1] - b[1]);
const today = process.env.TRANCO_RETRIEVED_DATE ?? "";
if (!today) {
  console.error(
    "TRANCO_RETRIEVED_DATE (例: 2026-08-26) を環境変数で指定してください",
  );
  process.exit(1);
}

const header = `// 自動生成ファイル — 手編集禁止。再生成は packages/shared で:
//   TRANCO_RETRIEVED_DATE=<取得日> node scripts/convert-tranco.mjs <csv> [--list-id=XXXXX] > src/uniqueness/corpusTranco.ts
// 生成元: Tranco top sites ranking (https://tranco-list.eu/, Le Pochat+ NDSS 2019)
//   公式 top-1m.csv.zip の上位1万行から SLD 抽出・重複除去したもの。
//   引用時は TRANCO_META.listId のリストIDを用いる (Tranco の推奨引用形式)。
// 除外: .arpa ${dropped.arpa}件 / punycode ${dropped.punycode}件 / 形式不正 ${dropped.invalid}件
//   / アダルト・海賊版 ${dropped.denied}件 (scripts/corpus-denylist.mjs) / 重複SLD ${dropped.dup}件
// データ形式: "rank:sld" の空白区切り文字列 (パースは corpusTranco.ts 内で行う)
`;

const body = entries.map(([sld, rank]) => `${rank}:${sld}`).join(" ");

process.stdout.write(`${header}import type { CorpusEntry } from "./corpus";

/** 生成元の出典メタ (§14 / DESIGN_RATIONALE の再現性要件)。 */
export const TRANCO_META = {
  /** Tranco 永続リストID (https://tranco-list.eu/top-1m-id)。sha- 接頭辞は未取得時の入力checksum代替 */
  listId: "${listId}",
  /** 元リストの取得日 */
  retrievedDate: "${today}",
  /** 入力CSV (上位1万行切り出し) の sha256 */
  inputSha256: "${sha256}",
  /** 重複除去後のエントリ数 */
  entryCount: ${entries.length},
} as const;

const RAW =
  "${body}".split(
    " ",
  );

/** Tranco 由来コーパス (rank 昇順)。curated との統合は defaultCorpus.ts が行う。 */
export const TRANCO_ENTRIES: readonly CorpusEntry[] = RAW.map((pair) => {
  const i = pair.indexOf(":");
  return {
    name: pair.slice(i + 1),
    tier: "tranco" as const,
    rank: Number(pair.slice(0, i)),
  };
});
`);
