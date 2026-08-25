/**
 * サブドメイン設計（FR-13）の表示用ラベルと導出（S-43 〜 S-46）。
 *
 * 反映状態は API / モックが返す `applyStatus` をそのまま使い、UI 側で
 * DNS ゾーンとの突き合わせをやり直さない（`docs/specs/ui-screens.md` §6 と同じ方針）。
 */

import type {
  ApplyStatus,
  DnsDiff,
  DnsRecord,
  SubdomainHost,
} from "@/lib/api/types";

/** ツリーのノードに出すバッジ（要件 FR-13「反映状態」）。 */
export const APPLY_STATUS_LABEL: Record<ApplyStatus, string> = {
  applied: "反映済み",
  changed: "変更あり",
  pending: "未反映",
};

export const APPLY_STATUS_TONE: Record<ApplyStatus, "ok" | "warn" | "muted"> = {
  applied: "ok",
  changed: "warn",
  pending: "muted",
};

export const PRIORITIES = ["required", "recommended", "optional"] as const;

export const PRIORITY_LABEL: Record<SubdomainHost["priority"], string> = {
  required: "必須",
  recommended: "推奨",
  optional: "任意",
};

export const RECORD_TYPES = ["A", "CNAME", "ALIAS"] as const;

export const RECORD_TYPE_OPTIONS = RECORD_TYPES.map((value) => ({
  value,
  label: value,
}));

export interface ApplyCounts {
  applied: number;
  changed: number;
  pending: number;
}

export function countApplyStatus(hosts: readonly SubdomainHost[]): ApplyCounts {
  const counts: ApplyCounts = { applied: 0, changed: 0, pending: 0 };
  for (const host of hosts) {
    counts[host.applyStatus] += 1;
  }
  return counts;
}

/**
 * 「反映済み 2・変更あり 1・未反映 1」/ 反映が済んでいれば「反映済み 4・差分なし」。
 * Figma S-43 `84:4874` / S-45 `84:5010` の「反映状況」行。
 */
export function applyStatusSummary(counts: ApplyCounts): string {
  const parts = [`${APPLY_STATUS_LABEL.applied} ${counts.applied}`];
  if (counts.changed > 0) {
    parts.push(`${APPLY_STATUS_LABEL.changed} ${counts.changed}`);
  }
  if (counts.pending > 0) {
    parts.push(`${APPLY_STATUS_LABEL.pending} ${counts.pending}`);
  }
  if (counts.changed === 0 && counts.pending === 0) {
    parts.push("差分なし");
  }
  return parts.join("・");
}

/** 反映で動くレコードの合計件数（AC-13-7 の「n 件」）。 */
export function diffTotal(diff: DnsDiff): number {
  return diff.added.length + diff.updated.length + diff.removed.length;
}

/** 反映後のバナー本文（S-45）に出す内訳。削除 0 件は出さない。 */
export function appliedSummary(result: {
  added: number;
  updated: number;
  removed: number;
}): string {
  const parts = [`追加 ${result.added}`, `変更 ${result.updated}`];
  if (result.removed > 0) {
    parts.push(`削除 ${result.removed}`);
  }
  return parts.join("・");
}

/** CNAME / ALIAS の向き先は FQDN 表記（末尾ドット）に寄せる。A レコードはそのまま。 */
function zoneTarget(
  host: Pick<SubdomainHost, "recordType" | "target">,
): string {
  const target = host.target.trim();
  if (host.recordType === "A" || target === "" || target.endsWith(".")) {
    return target;
  }
  return `${target}.`;
}

/** 外部 DNS に手で入れるための設定手順（FR-13「手動設定」/ Figma Code Block `48:507`）。 */
export function zoneFileText(hosts: readonly SubdomainHost[]): string {
  return hosts
    .map(
      (host) => `${host.host} 3600 IN ${host.recordType} ${zoneTarget(host)}`,
    )
    .join("\n");
}

/** 差分ダイアログ（S-44）の 1 行に出す「CNAME cname.example.com.」表記。 */
export function recordText(
  record: Pick<SubdomainHost | DnsRecord, "recordType" | "target">,
): string {
  return `${record.recordType} ${zoneTarget(record)}`;
}

/** 追加したホストに衝突しない ID を振る（保存前はサーバー ID が無い）。 */
export function nextHostId(hosts: readonly SubdomainHost[]): string {
  const used = new Set(hosts.map((host) => host.id));
  let index = hosts.length + 1;
  while (used.has(`draft-${index}`)) {
    index += 1;
  }
  return `draft-${index}`;
}

/** 追加直後のホスト名（`new` / `new-2` …）。 */
export function nextHostName(hosts: readonly SubdomainHost[]): string {
  const used = new Set(hosts.map((host) => host.host));
  if (!used.has("new")) {
    return "new";
  }
  let index = 2;
  while (used.has(`new-${index}`)) {
    index += 1;
  }
  return `new-${index}`;
}
