// ============================================================
// 既定コーパス: Tranco (生成物 corpusTranco.ts) + curated (corpusCurated.ts) の統合
// - 同名の重複は popularity の高い方を採用する (安全側 = より有名として扱う)。
//   同値なら tranco (rank による客観値) を優先する。
// - prepareCorpus はモジュール単位で1回だけ実行しキャッシュする
//   (8,900件超の正規化ビュー事前計算は毎リクエストで行わない)。
// - DB には置かない: コーパスはビルド成果物に同梱される静的データで、
//   API (tsup バンドル) からそのまま import できる (配置の根拠は ADR-0003)。
// ============================================================
import {
  type CorpusEntry,
  type PreparedCorpus,
  popularity,
  prepareCorpus,
} from "./corpus";
import { CURATED_ENTRIES } from "./corpusCurated";
import { TRANCO_ENTRIES, TRANCO_META } from "./corpusTranco";

/** 既定コーパスのバージョン識別子。結果の corpusVersion に転記される。 */
export const DEFAULT_CORPUS_VERSION = `tranco-${TRANCO_META.listId}-${TRANCO_META.retrievedDate}-top10k+curated-v1`;

/**
 * Tranco + curated を統合した既定コーパスのエントリ列を作る。
 * 重複名は popularity の高い方 (同値なら tranco) を採用する。
 */
export function buildDefaultCorpusEntries(): CorpusEntry[] {
  const byName = new Map<string, CorpusEntry>();
  for (const e of TRANCO_ENTRIES) byName.set(e.name, e);
  for (const e of CURATED_ENTRIES) {
    const existing = byName.get(e.name);
    if (existing === undefined || popularity(e) > popularity(existing)) {
      byName.set(e.name, e);
    }
  }
  return [...byName.values()];
}

let cached: PreparedCorpus | undefined;

/**
 * 前処理済みの既定コーパスを返す (モジュール単位でメモ化)。
 * scoreDistinctiveness(q, getDefaultPreparedCorpus()) が本番の標準呼び出し。
 */
export function getDefaultPreparedCorpus(): PreparedCorpus {
  if (cached === undefined) {
    cached = prepareCorpus(buildDefaultCorpusEntries(), {
      version: DEFAULT_CORPUS_VERSION,
    });
  }
  return cached;
}
