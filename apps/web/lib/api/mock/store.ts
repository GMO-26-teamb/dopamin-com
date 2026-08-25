/**
 * モックの状態（fe-ui 設計 §4.4）。
 *
 * 更新系（登録 / 更新 / 廃止 / 反映 / 移管）はこのモジュール内の in-memory ストアを書き換える。
 * ページ遷移をまたいで状態が残るのでデモの導線をそのまま辿れる。リロードで初期状態に戻る。
 */

import type { PasskeySummary } from "@dopamin/shared";
import type {
  AiLog,
  Candidate,
  DnsRecord,
  DomainDetail,
  Me,
  OperationLog,
  SubdomainPlan,
  Transfer,
} from "../types";
import {
  createAiLogs,
  createCandidatePool,
  createDnsZones,
  createDomains,
  createMe,
  createOperationLogs,
  createPasskeys,
  createSubdomainPlans,
  createTransfers,
  DASHBOARD_DOMAINS,
} from "./fixtures";

export interface MockStore {
  /** 名前 → ドメイン（詳細画面用の保有外ドメインも含む）。 */
  domains: Map<string, DomainDetail>;
  /** ダッシュボード（`GET /domains`）に出す順序付きの名前。登録すると増える。 */
  listedNames: string[];
  plans: Map<string, SubdomainPlan>;
  /** 疑似 DNS ゾーン（ドメイン名 → レコード）。 */
  zones: Map<string, DnsRecord[]>;
  candidatePool: Candidate[];
  transfers: Transfer[];
  operationLogs: OperationLog[];
  aiLogs: AiLog[];
  passkeys: PasskeySummary[];
  me: Me;
  /** 採番用のカウンタ（移管 ID / パスキー ID）。 */
  sequence: number;
}

export function createInitialStore(): MockStore {
  return {
    domains: new Map(createDomains().map((d) => [d.name, d])),
    listedNames: [...DASHBOARD_DOMAINS],
    plans: new Map(Object.entries(createSubdomainPlans())),
    zones: new Map(Object.entries(createDnsZones())),
    candidatePool: createCandidatePool(),
    transfers: createTransfers(),
    operationLogs: createOperationLogs(),
    aiLogs: createAiLogs(),
    passkeys: createPasskeys(),
    me: createMe(),
    sequence: 100,
  };
}

let store: MockStore = createInitialStore();

export function getMockStore(): MockStore {
  return store;
}

/** ストアを fixtures の初期状態に戻す（テストの `beforeEach` と FR-16 デモリセット）。 */
export function resetMockStore(): void {
  store = createInitialStore();
}
