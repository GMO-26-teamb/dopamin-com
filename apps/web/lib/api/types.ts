/**
 * 画面用の ViewModel（fe-ui 設計 §4.1）。
 *
 * `packages/shared` の `DomainInfo` / `AuthUser` / `PasskeySummary` / `ApiError` を再利用し、
 * 画面が必要とする導出済みの値（`displayStatus` / 残日数の元になる日付 / 反映状態）だけを足す。
 * EPP ステータスの再解釈は UI 側では行わない（`deriveDisplayStatus` が SSOT）。
 */

import type {
  AiProvider,
  ApiError,
  AuthUser,
  DisplayStatus,
  ErrorCode,
  OrderQuote,
  RegistrantProfile,
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
  code: ErrorCode;
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
 * `street` / `city` / `countryCode` は D-02 に入力欄が無いので HTTP 実装が
 * `DEFAULT_REGISTRANT_PROFILE` から補う（#172）。
 * S-39（移管 IN 後のコンタクト未移行）の再実行はこの入力で行う。
 */
export interface DomainContactsInput {
  /** 氏名は許可された 8 種のダミー値のみ（`ALLOWED_CONTACT_NAMES`）。 */
  registrant: { name: RegistrantProfile["name"]; email: string };
}

export interface UniquenessScore {
  /** 独自性スコア（0〜100）。`uniquenessLabel` / `rarityTier` の入力。 */
  score: number;
  label: "high" | "medium" | "low";
  /**
   * 最も近い既存名（上位 3 件）。`similarity` は **0〜1** の文字列類似度で、
   * API（docs/requirements.md §10.4 の `topSimilar`）と同じ単位
   * （算出方式は embedding から lexical へ変更。ADR-0003）。
   * 表示は `SimilarityRow` が 0.61 のように小数 2 桁で出す（ui-design 14-domains-new）。
   */
  nearest: { name: string; similarity: number }[];
}

/**
 * `POST /uniqueness/preview` の結果（FR-05 / S-00 のお試しスコア）。
 * 空き確認をしない口なので、スコアは必ず付く（`SearchResult` と違い null にならない）。
 */
export interface UniquenessPreview {
  /** スコアの対象になった SLD（`gogle.com` と入れても `gogle` で判定する）。 */
  sld: string;
  uniqueness: UniquenessScore;
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
  error: ApiError["error"] | null;
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
  provider: AiProvider;
  model: string;
  providers: { id: AiProvider; models: string[] }[];
}

export interface Me {
  user: AuthUser;
  features: { demoReset: boolean };
  ai: AiSettings;
}

// ---- 決済（FR-19、モック） ----

/** カード入力欄の値（表示用の整形済み文字列。PSP には送らない）。 */
export interface PaymentCardInput {
  /** `4242 4242 4242 4242` のように 4 桁区切り */
  number: string;
  /** `MM/YY` */
  expiry: string;
  cvc: string;
  holder: string;
}

export interface PaymentChargeInput {
  /** `quoteOrder()`（packages/shared）の見積もり。金額はここから取る */
  quote: OrderQuote;
  card: PaymentCardInput;
}

/** 決済の受付控え。実 PSP を繋いだときも同じ形にする。 */
export interface PaymentReceipt {
  /** 受付番号（`pay_` + 8 文字） */
  id: string;
  paidAt: string;
  amount: number;
  currency: OrderQuote["currency"];
  brand: string;
  last4: string;
  /** 摘要（例 `takutaku.com 新規登録 2 年`） */
  description: string;
}

export type PaymentErrorCode = "CARD_DECLINED";

/**
 * 決済の結果。拒否は例外ではなく値で返す（`ApiClientError` の統一コードには
 * 決済が無く、Error Card ではなくダイアログ内の Banner で見せるため）。
 */
export type PaymentResult =
  | { ok: true; receipt: PaymentReceipt }
  | { ok: false; code: PaymentErrorCode; message: string };
