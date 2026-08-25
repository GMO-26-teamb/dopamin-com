import { randomUUID } from "node:crypto";
import type {
  CheckResult,
  ClientStatus,
  CreateInput,
  DeleteResult,
  DomainInfo,
  HelloResult,
  RegistryId,
  RenewInput,
  TransferResult,
  UpdateInput,
} from "@dopamin/shared";
import type { RegistryAdapter } from "./adapter";
import { RegistryError } from "./errors";
import { REGISTRY_TLDS, SUPPORTED_TLDS } from "./routing";

/** エラーシミュレーション用の失敗モード（docs/requirements.md §11.6）。 */
export type MockFailMode =
  | "none"
  | "timeout"
  | "5xx"
  | "reject"
  | "spec_mismatch";

interface MockDomainState {
  name: string;
  registrant: string;
  contacts: Record<string, string>;
  nameservers: string[];
  clientStatuses: ClientStatus[];
  crDate: string;
  upDate: string | null;
  exDate: string;
  trDate: string | null;
  rgpStatuses: string[];
  authInfo: string;
  pendingDelete: boolean;
  pendingTransfer: boolean;
}

function addYears(iso: string, years: number): string {
  const date = new Date(iso);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString();
}

/** ステータスは状態から決定的に導出する（ok は他ステータスと排他）。 */
function deriveStatuses(state: MockDomainState): string[] {
  if (state.pendingDelete) {
    return ["pendingDelete"];
  }
  const statuses: string[] = [];
  if (state.pendingTransfer) {
    statuses.push("pendingTransfer");
  }
  statuses.push(...state.clientStatuses);
  if (state.nameservers.length === 0) {
    statuses.push("inactive");
  }
  if (statuses.length === 0) {
    statuses.push("ok");
  }
  return statuses;
}

/**
 * ローカル開発・テスト・デモ用のインメモリレジストリ（docs/requirements.md §11.1）。
 * 実レジストリと同じ状態遷移（inactive/ok、RGP、移管、ロック）を再現し、
 * failMode でエラーシミュレーションができる。
 */
export class MockRegistryAdapter implements RegistryAdapter {
  readonly id: RegistryId;
  readonly specVersion = "mock";
  private readonly domains = new Map<string, MockDomainState>();
  private readonly now: () => Date;
  private failMode: MockFailMode;

  constructor(options?: {
    /**
     * 名乗るレジストリ ID（既定 "mock"）。kitaqsign / kitaqnic を指定すると
     * TLD ルーティング・グルーピング・エラーの registry が本番と同じ形になる
     * （API 統合テストでレジストリ単位の部分失敗を再現するために使う）。
     */
    id?: RegistryId;
    failMode?: MockFailMode;
    now?: () => Date;
  }) {
    this.id = options?.id ?? "mock";
    this.failMode = options?.failMode ?? "none";
    this.now = options?.now ?? (() => new Date());
  }

  /** テスト・デモリセット用に失敗モードを切り替える。 */
  setFailMode(mode: MockFailMode): void {
    this.failMode = mode;
  }

  private gate(command: string): void {
    switch (this.failMode) {
      case "timeout":
        throw new RegistryError({
          code: "REGISTRY_TIMEOUT",
          registry: this.id,
          message: `${command}: モックレジストリがタイムアウトしました（failMode=timeout）`,
        });
      case "5xx":
        throw new RegistryError({
          code: "REGISTRY_UNAVAILABLE",
          registry: this.id,
          message: `${command}: モックレジストリが 5xx を返しました（failMode=5xx）`,
          httpStatus: 503,
        });
      case "reject":
        throw new RegistryError({
          code: "REGISTRY_REJECTED",
          registry: this.id,
          message: `${command}: モックレジストリがコマンドを拒否しました（failMode=reject）`,
          registryCode: 2306,
        });
      case "spec_mismatch":
        throw new RegistryError({
          code: "REGISTRY_SPEC_MISMATCH",
          registry: this.id,
          message: `${command}: モックレジストリの応答が仕様と一致しません（failMode=spec_mismatch）`,
        });
      default:
        return;
    }
  }

  private getState(name: string, command: string): MockDomainState {
    const state = this.domains.get(name.toLowerCase());
    if (!state) {
      throw new RegistryError({
        code: "NOT_FOUND",
        registry: this.id,
        message: `${command}: ${name} は存在しません`,
        registryCode: 2303,
      });
    }
    return state;
  }

  private toInfo(state: MockDomainState): DomainInfo {
    return {
      name: state.name,
      registry: this.id,
      statuses: deriveStatuses(state),
      registrant: state.registrant,
      contacts: { ...state.contacts },
      nameservers: [...state.nameservers],
      registeredAt: state.crDate,
      updatedAt: state.upDate,
      expiresAt: state.exDate,
      lastTransferAt: state.trDate,
      rgpStatuses: [...state.rgpStatuses],
    };
  }

  async hello(): Promise<HelloResult> {
    this.gate("hello");
    // 特定レジストリを名乗る場合は対応 TLD もそのレジストリの部分集合にする
    const id = this.id;
    const tlds = id === "mock" ? [...SUPPORTED_TLDS] : [...REGISTRY_TLDS[id]];
    return { registry: id, tlds };
  }

  async check(names: string[]): Promise<CheckResult[]> {
    this.gate("check");
    return names.map((name) => {
      const taken = this.domains.has(name.toLowerCase());
      return taken
        ? { name: name.toLowerCase(), available: false, reason: "in use" }
        : { name: name.toLowerCase(), available: true };
    });
  }

  async info(name: string): Promise<DomainInfo> {
    this.gate("info");
    return this.toInfo(this.getState(name, "info"));
  }

  async create(input: CreateInput): Promise<DomainInfo> {
    this.gate("create");
    const name = input.name.toLowerCase();
    if (this.domains.has(name)) {
      throw new RegistryError({
        code: "CONFLICT",
        registry: this.id,
        message: `create: ${name} は既に存在します`,
        registryCode: 2302,
      });
    }
    const nowIso = this.now().toISOString();
    const registrant = `mock-${randomUUID().slice(0, 8)}`;
    const state: MockDomainState = {
      name,
      registrant,
      contacts: { TECH: registrant },
      nameservers: input.nameservers ? [...input.nameservers] : [],
      clientStatuses: [],
      crDate: nowIso,
      upDate: null,
      exDate: addYears(nowIso, input.periodYears),
      trDate: null,
      rgpStatuses: ["addPeriod"],
      authInfo: input.authInfo,
      pendingDelete: false,
      pendingTransfer: false,
    };
    this.domains.set(name, state);
    return this.toInfo(state);
  }

  async renew(name: string, input: RenewInput): Promise<DomainInfo> {
    this.gate("renew");
    const state = this.getState(name, "renew");
    const statuses = deriveStatuses(state);
    if (
      state.pendingDelete ||
      state.pendingTransfer ||
      statuses.includes("clientRenewProhibited")
    ) {
      throw new RegistryError({
        code: "OPERATION_NOT_ALLOWED",
        registry: this.id,
        message: `renew: ${name} は現在のステータスでは更新できません`,
        registryCode: 2304,
      });
    }
    if (input.currentExpiresAt.slice(0, 10) !== state.exDate.slice(0, 10)) {
      throw new RegistryError({
        code: "REGISTRY_REJECTED",
        registry: this.id,
        message: `renew: curExpDate が現在の有効期限と一致しません`,
        registryCode: 2306,
      });
    }
    state.exDate = addYears(state.exDate, input.periodYears);
    state.upDate = this.now().toISOString();
    return this.toInfo(state);
  }

  async update(name: string, input: UpdateInput): Promise<DomainInfo> {
    this.gate("update");
    const state = this.getState(name, "update");
    const removingOnly =
      !input.addNameservers?.length &&
      !input.removeNameservers?.length &&
      !input.addStatuses?.length &&
      (input.removeStatuses?.length ?? 0) > 0;
    if (
      state.pendingDelete ||
      state.pendingTransfer ||
      (state.clientStatuses.includes("clientUpdateProhibited") && !removingOnly)
    ) {
      throw new RegistryError({
        code: "OPERATION_NOT_ALLOWED",
        registry: this.id,
        message: `update: ${name} は現在のステータスでは変更できません`,
        registryCode: 2304,
      });
    }
    const nsSet = new Set(state.nameservers);
    for (const ns of input.addNameservers ?? []) {
      nsSet.add(ns.toLowerCase());
    }
    for (const ns of input.removeNameservers ?? []) {
      nsSet.delete(ns.toLowerCase());
    }
    state.nameservers = [...nsSet];

    const statusSet = new Set(state.clientStatuses);
    for (const status of input.addStatuses ?? []) {
      statusSet.add(status);
    }
    for (const status of input.removeStatuses ?? []) {
      statusSet.delete(status);
    }
    state.clientStatuses = [...statusSet];
    state.upDate = this.now().toISOString();
    return this.toInfo(state);
  }

  async delete(name: string): Promise<DeleteResult> {
    this.gate("delete");
    const state = this.getState(name, "delete");
    if (
      state.pendingDelete ||
      state.pendingTransfer ||
      state.clientStatuses.includes("clientDeleteProhibited")
    ) {
      throw new RegistryError({
        code: "OPERATION_NOT_ALLOWED",
        registry: this.id,
        message: `delete: ${name} は現在のステータスでは廃止できません`,
        registryCode: 2304,
      });
    }
    state.pendingDelete = true;
    state.rgpStatuses = ["redemptionPeriod"];
    state.upDate = this.now().toISOString();
    return { name: state.name };
  }

  async restore(name: string): Promise<DomainInfo> {
    this.gate("restore");
    const state = this.getState(name, "restore");
    if (!state.rgpStatuses.includes("redemptionPeriod")) {
      throw new RegistryError({
        code: "OPERATION_NOT_ALLOWED",
        registry: this.id,
        message: `restore: ${name} は復旧猶予期間ではありません`,
        registryCode: 2304,
      });
    }
    state.pendingDelete = false;
    state.rgpStatuses = [];
    state.upDate = this.now().toISOString();
    return this.toInfo(state);
  }

  async transferRequest(
    name: string,
    authCode: string,
  ): Promise<TransferResult> {
    this.gate("transfer:request");
    const state = this.getState(name, "transfer:request");
    if (authCode !== state.authInfo) {
      throw new RegistryError({
        code: "REGISTRY_REJECTED",
        registry: this.id,
        message: `transfer:request: AuthCode が一致しません`,
        registryCode: 2202,
      });
    }
    if (
      state.pendingDelete ||
      state.clientStatuses.includes("clientTransferProhibited")
    ) {
      throw new RegistryError({
        code: "OPERATION_NOT_ALLOWED",
        registry: this.id,
        message: `transfer:request: ${name} は現在のステータスでは移管できません`,
        registryCode: 2304,
      });
    }
    state.pendingTransfer = true;
    state.upDate = this.now().toISOString();
    return {
      name: state.name,
      status: "pending",
      gainingRegistrar: "MOCK-GAINING",
      losingRegistrar: "MOCK-LOSING",
    };
  }

  async transferQuery(name: string): Promise<TransferResult> {
    this.gate("transfer:query");
    const state = this.getState(name, "transfer:query");
    return {
      name: state.name,
      status: state.pendingTransfer ? "pending" : "none",
      gainingRegistrar: state.pendingTransfer ? "MOCK-GAINING" : null,
      losingRegistrar: state.pendingTransfer ? "MOCK-LOSING" : null,
    };
  }

  async authCode(name: string): Promise<string> {
    this.gate("rotate-auth-info");
    const state = this.getState(name, "rotate-auth-info");
    state.authInfo = `mock-${randomUUID()}`;
    return state.authInfo;
  }
}
