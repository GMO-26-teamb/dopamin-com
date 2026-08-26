// ============================================================
// curated コーパス (手動管理)
// Tranco が拾いにくい国内知名度・開発者向け知名度を固定 popularity で補う層。
// 検証ハーネス uniq-lab/corpus.mjs の curated 層と同一リスト (較正の前提)。
// 追加・削除するときは:
//   1. 理由をコミットログに残す
//   2. packages/shared のテストと監査 (AUDIT_TRANCO.md) を再実行する
// Tranco と重複する名前は defaultCorpus.ts が popularity の高い方を採用する。
// ============================================================
import type { CorpusEntry } from "./corpus";

/** 国内有名サービス (popularity 0.90 固定 = popJp)。 */
export const CURATED_JP: readonly CorpusEntry[] = [
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
];

/** 開発者向け有名サービス (popularity 0.85 固定 = popTech)。 */
export const CURATED_TECH: readonly CorpusEntry[] = [
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

/** curated 全量 (jp + tech)。 */
export const CURATED_ENTRIES: readonly CorpusEntry[] = [
  ...CURATED_JP,
  ...CURATED_TECH,
];
