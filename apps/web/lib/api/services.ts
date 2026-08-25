/**
 * データ取得のインターフェース（fe-ui 設計 §4.2）。
 *
 * 画面はこのインターフェースにだけ依存する。実装は `mock/`（既定）と `http/`（Hono RPC）の 2 つで、
 * `NEXT_PUBLIC_API_MODE` により `provider.tsx` が切り替える。
 * 失敗はすべて `ApiClientError`（`errors.ts`）で投げる。
 */

import type {
  AuthUser,
  DomainCheckRequest,
  PasskeySummary,
} from "@dopamin/shared";
import type {
  AiLog,
  AiSettings,
  Candidate,
  DnsDiff,
  DomainContactsInput,
  DomainDetail,
  DomainSummary,
  Me,
  OperationLog,
  SearchResult,
  SubdomainPlan,
  Transfer,
} from "./types";

/** `DomainService.update` の入力（要件 §10.1 の `PATCH /domains/:name`）。 */
export interface DomainUpdateInput {
  /** 変更後の全量（0 件 = 全解除、または 2〜13 件）。 */
  nameservers?: string[];
  /** 登録者コンタクトの差し替え（S-39 の再実行）。 */
  contacts?: DomainContactsInput;
}

export interface AuthService {
  isSupported(): boolean;
  signup(displayName: string): Promise<AuthUser>;
  login(): Promise<AuthUser>;
  logout(): Promise<void>;
  addPasskey(): Promise<PasskeySummary>;
  listPasskeys(): Promise<PasskeySummary[]>;
  deletePasskey(id: string): Promise<void>;
}

export interface DomainService {
  /** GET /domains（未実装 → NOT_IMPLEMENTED） */
  list(): Promise<DomainSummary[]>;
  /** POST /domains/sync */
  sync(): Promise<DomainSummary[]>;
  /** GET /domains/:name */
  get(name: string): Promise<DomainDetail>;
  /** POST /domains/check */
  check(input: DomainCheckRequest): Promise<SearchResult[]>;
  /** POST /domains */
  register(input: { name: string; period: number }): Promise<DomainDetail>;
  renew(name: string, input: { period: number }): Promise<DomainDetail>;
  /** PATCH /domains/:name（FR-09。contacts は S-39 の再実行で使う） */
  update(name: string, input: DomainUpdateInput): Promise<DomainDetail>;
  remove(name: string): Promise<{ outcome: "rgp" | "deleted" }>;
  restore(name: string): Promise<DomainDetail>;
  authCode(name: string): Promise<{ authCode: string }>;
}

export interface CandidateService {
  generate(input: {
    nickname: string;
    purpose?: string;
    tlds?: string[];
    exclude?: string[];
  }): Promise<Candidate[]>;
}

export interface SubdomainService {
  get(domain: string): Promise<SubdomainPlan | null>;
  propose(
    domain: string,
    input: { repoUrl?: string; description?: string },
  ): Promise<SubdomainPlan>;
  save(domain: string, plan: SubdomainPlan): Promise<SubdomainPlan>;
  diff(domain: string): Promise<DnsDiff>;
  apply(domain: string): Promise<{
    plan: SubdomainPlan;
    added: number;
    updated: number;
    removed: number;
    nameserversChanged: boolean;
  }>;
}

export interface TransferService {
  list(): Promise<Transfer[]>;
  refresh(): Promise<Transfer[]>;
  request(input: { name: string; authCode: string }): Promise<Transfer>;
  approve(id: string): Promise<Transfer>;
  reject(id: string): Promise<Transfer>;
  cancel(id: string): Promise<Transfer>;
}

export interface LogService {
  operations(): Promise<OperationLog[]>;
  ai(): Promise<AiLog[]>;
}

export interface SettingsService {
  me(): Promise<Me>;
  updateAi(input: {
    provider: AiSettings["provider"];
    model: string;
  }): Promise<AiSettings>;
  demoReset(): Promise<void>;
}

export interface Services {
  auth: AuthService;
  domains: DomainService;
  candidates: CandidateService;
  subdomains: SubdomainService;
  transfers: TransferService;
  logs: LogService;
  settings: SettingsService;
}
