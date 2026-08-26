/**
 * 画面用の ViewModel（fe-ui 設計 §4.1）。
 *
 * `packages/shared` の `DomainInfo` / `AuthUser` / `PasskeySummary` / `ApiErrorBody` を再利用し、
 * 画面が必要とする導出済みの値（`displayStatus` / 残日数の元になる日付 / 反映状態）だけを足す。
 * EPP ステータスの再解釈は UI 側では行わない（`deriveDisplayStatus` が SSOT）。
 */

import type {
  ApiErrorBody,
  ApiErrorCode,
  AuthUser,
  DisplayStatus,
} from "@dopamin/shared";

export type Ownership = "owned" | "transferred_out";

export interface DomainSummary {
  name: string;
  sld: string;
  tld: string;
  registry: "kitaqsign" | "kitaqnic" | "mock";
  statuses: string[];
  rgpStatuses: string[];
  ownership: Ownership;
  /** deriveDisplayStatus の結果（SSOT） */
  displayStatus: DisplayStatus;
  registeredAt: string;
  expiresAt: string | null;
  rgpUntil: string | null;
  syncedAt: string;
  /** 直近の sync に失敗したらキャッシュ表示 */
  stale: boolean;
  transfer: { direction: "in" | "out"; actByAt: string } | null;
}

export interface GracePeriod {
  kind:
    | "add"
    | "renew"
    | "transfer"
    | "autoRenew"
    | "redemption"
    | "pendingDelete";
  until: string;
}

export interface DomainDetail extends DomainSummary {
  nameservers: string[];
  /** migrated=false → S-39（移管 IN 後にコンタクトが旧レジストラのまま） */
  registrant: { name: string; email: string; migrated: boolean };
  gracePeriods: GracePeriod[];
  transferableFrom: string | null;
  subdomainPlan: { hosts: number; applied: number } | null;
}

/**
 * `POST /domains/sync` で同期できなかった 1 件（S-13 / AC-18-1）。
 *
 * `code` は API の `domainSyncFailureSchema` と同じ §10.3 の統一コード。
 * `registry` は名前の TLD から引いた「落ちた相手」で、Banner の見出しを
 * 具体名（「Kitaqsign が応答しません」）にするために使う。
 */
export interface SyncFailure {
  name: string;
  code: ApiErrorCode;
  message: string;
  /** 未対応 TLD なら null（レジストリを名指しできない）。 */
  registry: Exclude<DomainSummary["registry"], "mock"> | null;
}

/**
 * `POST /domains/sync` の結果。
 *
 * 部分失敗は例外にせずここに載せる。画面は `domains` を必ずキャッシュに書き込み、
 * 失敗した行だけを stale として描く（S-13 は「カード単位」で出す仕様）。
 * 例外になるのはリクエスト自体が失敗したときだけ（401 / 5xx / ネットワーク）。
 */
export interface SyncResult {
  domains: DomainSummary[];
  failures: SyncFailure[];
}

/**
 * `PATCH /domains/:name` に渡すコンタクト（FR-09 / 要件 §10.1 の `contacts`）。
 *
 * 登録者（Registrant）のみを扱う。技術（Technical）は FR-09 上は任意だが
 * {@link DomainDetail} に保持先が無いため、この ViewModel では扱わない。
 * 値はレジストリが許可するダミー PII のみ（`RegistrantProfile`）。
 * S-39（移管 IN 後のコンタクト未移行）の再実行はこの入力で行う。
 */
export interface DomainContactsInput {
  registrant: { name: string; email: string };
}

export interface UniquenessScore {
  /** 独自性スコア（0〜100）。`uniquenessLabel` / `rarityTier` の入力。 */
  score: number;
  label: "high" | "medium" | "low";
  /**
   * 最も近い既存名（上位 3 件）。`similarity` は **0〜1** のコサイン類似度で、
   * API（docs/requirements.md §10.2 の `topSimilar`）と同じ単位。
   * 表示は `SimilarityRow` が 0.61 のように小数 2 桁で出す（ui-design 14-domains-new）。
   */
  nearest: { name: string; similarity: number }[];
}

export type Availability = "available" | "unavailable" | "error";

export interface Candidate {
  sld: string;
  tld: string;
  reason: string;
  registry: DomainSummary["registry"];
  availability: Availability;
  uniqueness: UniquenessScore | null;
  alternatives: string[];
}

export interface SearchResult {
  name: string;
  sld: string;
  tld: string;
  registry: DomainSummary["registry"];
  availability: Availability;
  uniqueness: UniquenessScore | null;
  alternatives: string[];
  error: ApiErrorBody["error"] | null;
}

export type ApplyStatus = "applied" | "changed" | "pending";

export interface SubdomainHost {
  id: string;
  host: string;
  purpose: string;
  recordType: "A" | "CNAME" | "ALIAS";
  target: string;
  priority: "required" | "recommended" | "optional";
  applyStatus: ApplyStatus;
}

export interface SubdomainPlan {
  domain: string;
  repoUrl: string | null;
  policy: string;
  hosts: SubdomainHost[];
  nameserversSwitched: boolean;
  savedAt: string | null;
  appliedAt: string | null;
}

export interface DnsRecord {
  host: string;
  recordType: SubdomainHost["recordType"];
  target: string;
  ttl: number;
}

export interface DnsDiff {
  added: SubdomainHost[];
  updated: { host: SubdomainHost; previous: DnsRecord }[];
  removed: DnsRecord[];
  unchanged: string[];
}

export interface Transfer {
  id: string;
  domainName: string;
  registry: DomainSummary["registry"];
  direction: "in" | "out";
  status: "pending" | "import_pending" | "approved" | "rejected" | "cancelled";
  requestedAt: string;
  actByAt: string | null;
  completedAt: string | null;
}

export interface OperationLog {
  id: string;
  at: string;
  command: string;
  registry: DomainSummary["registry"];
  domainName: string | null;
  status: "success" | "error" | "timeout" | "spec_mismatch";
  errorCode: string | null;
  registryCode: string | null;
  latencyMs: number;
  request: unknown;
  response: unknown;
}

export interface AiLog {
  id: string;
  at: string;
  feature: "domain_candidates" | "uniqueness" | "subdomain_plan";
  provider: string;
  model: string;
  inputSummary: string;
  outputSummary: string;
  status: "success" | "error";
  latencyMs: number;
  tokens: number | null;
  raw: unknown;
}

export interface AiSettings {
  provider: "google" | "anthropic";
  model: string;
  providers: { id: "google" | "anthropic"; models: string[] }[];
}

export interface Me {
  user: AuthUser;
  features: { demoReset: boolean };
  ai: AiSettings;
}
