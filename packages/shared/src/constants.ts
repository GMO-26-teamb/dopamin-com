/** ドパ民が提供する DNS のネームサーバ（docs/requirements.md §7 系、NS 切替判定の基準値）。 */
export const DOPAMIN_NAMESERVERS = [
  "ns1.dopamin.ut42tech.com",
  "ns2.dopamin.ut42tech.com",
] as const;

/** 大文字小文字・末尾ドットの違いを無視してネームサーバを比較できるよう正規化する。 */
function normalizeNameserver(nameserver: string): string {
  const lower = nameserver.toLowerCase();
  return lower.endsWith(".") ? lower.slice(0, -1) : lower;
}

/**
 * 渡されたネームサーバ一覧がドパ民 DNS（{@link DOPAMIN_NAMESERVERS} の両方）を含んでいるか判定する。
 * 大文字小文字・末尾ドットの有無は無視する。
 */
export function isDopaminNameservers(nameservers: readonly string[]): boolean {
  const normalized = new Set(nameservers.map(normalizeNameserver));
  return DOPAMIN_NAMESERVERS.every((ns) => normalized.has(ns));
}
