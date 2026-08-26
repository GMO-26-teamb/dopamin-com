import { randomUUID } from "node:crypto";
import {
  type CheckResult,
  type ClientStatus,
  type CreateInput,
  type DeleteResult,
  type DomainInfo,
  type HelloResult,
  type OperationCommand,
  operationLogStatusFromErrorCode,
  type RegistryId,
  type RenewInput,
  TRANSFER_AUTO_APPROVE_MS,
  type TransferResult,
  type TransferStatus,
  type UpdateInput,
} from "@dopamin/shared";
import type { RegistryAdapter } from "./adapter";
import { RegistryError } from "./errors";
import type { ClTridFactory, RegistryCallObserver } from "./observer";
import { REGISTRY_TLDS, SUPPORTED_TLDS } from "./routing";

/** エラーシミュレーション用の失敗モード（docs/requirements.md §11.6）。 */
export type MockFailMode =
  | "none"
  | "timeout"
  | "5xx"
  | "reject"
  | "spec_mismatch";

/**
 * 進行中の移管申請。approve / reject / cancel の応答は申請時のレジストラ ID・
 * 日時をそのまま返す必要があるため、boolean ではなく申請内容ごと保持する。
 */
interface MockPendingTransfer {
  /** 申請した側（レジストリの gainingRegistrar）。 */
  requestingRegistrarId: string;
  /** 承認 / 拒否の権限を持つ側（レジストリの losingRegistrar）。 */
  actingRegistrarId: string;
  requestedAt: string;
  /** 放置時にサーバが自動承認する期限（FR-12。既定 20 分後）。 */
  actByAt: string;
}

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
  /** 移管申請中なら申請内容、そうでなければ null。 */
  pendingTransfer: MockPendingTransfer | null;
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
  if (state.pendingTransfer !== null) {
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

/** mock が名乗る自レジストラ ID（実レジストリの `X-Registrar-Id` 相当）。 */
const MOCK_REGISTRAR_ID = "MOCK-REGISTRAR";
/** mock が相手取る他レジストラ ID（requirements §22 の `MOCK_FOREIGN_REGISTRAR_ID` 相当）。 */
const MOCK_FOREIGN_REGISTRAR_ID = "MOCK-FOREIGN";

/** 移管完了後に付く RGP（RFC 3915 の Transfer Grace Period）。 */
const TRANSFER_GRACE_PERIOD = "transferPeriod";

/**
 * ローカル開発・テスト・デモ用のインメモリレジストリ（docs/requirements.md §11.1）。
 * 実レジストリと同じ状態遷移（inactive/ok、RGP、移管、ロック）を再現し、
 * failMode でエラーシミュレーションができる。
 */
export class MockRegistryAdapter implements RegistryAdapter {
  readonly id: RegistryId;
  /** 自レジストラ ID（§11.1）。移管の direction 導出に使う（ADR-0002 決定 3）。 */
  readonly registrarId: string;
  readonly specVersion = "mock";
  /** 移管の相手役として名乗る他レジストラ ID。 */
  private readonly foreignRegistrarId: string;
  private readonly domains = new Map<string, MockDomainState>();
  private readonly now: () => Date;
  private failMode: MockFailMode;
  private readonly onCall?: RegistryCallObserver;
  private readonly makeClTrid?: ClTridFactory;

  constructor(options?: {
    /**
     * 名乗るレジストリ ID（既定 "mock"）。kitaqsign / kitaqnic を指定すると
     * TLD ルーティング・グルーピング・エラーの registry が本番と同じ形になる
     * （API 統合テストでレジストリ単位の部分失敗を再現するために使う）。
     */
    id?: RegistryId;
    /** 自レジストラ ID（既定 `MOCK-REGISTRAR`）。 */
    registrarId?: string;
    /**
     * 移管の相手レジストラ ID（既定 `MOCK-FOREIGN`）。
     * 自分と同じ値を渡すと direction が導出できなくなるため別値にする。
     */
    foreignRegistrarId?: string;
    failMode?: MockFailMode;
    now?: () => Date;
    /** 操作ログ（FR-15）用の観測フック。公開メソッド 1 回 = 1 レコード。 */
    onCall?: RegistryCallObserver;
    /** clTRID の採番上書き。null 返却時は既定の採番。 */
    makeClTrid?: ClTridFactory;
  }) {
    this.id = options?.id ?? "mock";
    this.registrarId = options?.registrarId ?? MOCK_REGISTRAR_ID;
    this.foreignRegistrarId =
      options?.foreignRegistrarId ?? MOCK_FOREIGN_REGISTRAR_ID;
    this.failMode = options?.failMode ?? "none";
    this.now = options?.now ?? (() => new Date());
    this.onCall = options?.onCall;
    this.makeClTrid = options?.makeClTrid;
  }

  /** テスト・デモリセット用に失敗モードを切り替える。 */
  setFailMode(mode: MockFailMode): void {
    this.failMode = mode;
  }

  /**
   * 公開メソッド 1 回 = 1 レコードで観測フックを呼ぶ（FR-15）。
   * 実レジストリと違い HTTP 往復が無いため、補助コマンド行は発行せず svTrid は null。
   * observer の失敗はレジストリ操作の成否に影響させない。
   */
  private async recorded<T>(
    command: OperationCommand,
    domainName: string | null,
    request: unknown,
    fn: () => Promise<T>,
    toResponse: (result: T) => unknown = (result) => result,
  ): Promise<T> {
    if (!this.onCall) {
      return fn();
    }
    const clTrid = this.makeClTrid?.() ?? `mock-${randomUUID().slice(0, 12)}`;
    const startedAt = Date.now();
    try {
      const result = await fn();
      await this.emit({
        command,
        domainName,
        clTrid,
        errorCode: null,
        registryCode: null,
        request,
        response: toResponse(result),
        latencyMs: Date.now() - startedAt,
      });
      return result;
    } catch (err) {
      const error = err instanceof RegistryError ? err : null;
      await this.emit({
        command,
        domainName,
        clTrid,
        errorCode: error?.code ?? null,
        registryCode:
          error?.registryCode !== undefined ? String(error.registryCode) : null,
        request,
        response: error
          ? { message: error.message, reason: error.reason ?? null }
          : null,
        latencyMs: Date.now() - startedAt,
      });
      throw err;
    }
  }

  private async emit(input: {
    command: OperationCommand;
    domainName: string | null;
    clTrid: string;
    errorCode: RegistryError["code"] | null;
    registryCode: string | null;
    request: unknown;
    response: unknown;
    latencyMs: number;
  }): Promise<void> {
    if (!this.onCall) {
      return;
    }
    try {
      await this.onCall({
        registry: this.id,
        command: input.command,
        domainName: input.domainName,
        clTrid: input.clTrid,
        svTrid: null,
        status: operationLogStatusFromErrorCode(input.errorCode),
        errorCode: input.errorCode,
        registryCode: input.registryCode,
        request: input.request,
        response: input.response,
        latencyMs: input.latencyMs,
      });
    } catch {
      // 観測フックの失敗は握りつぶす
    }
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
      // 実レジストリの info 応答に clID が無いので mock も返さない（挙動を揃える）。
      // 移管 OUT 検知のシミュレーションは #45 / #56 で Poll 側に載せる。
      sponsoringRegistrarId: null,
      rgpStatuses: [...state.rgpStatuses],
    };
  }

  async hello(): Promise<HelloResult> {
    return this.recorded("hello", null, null, () => this.doHello());
  }

  private async doHello(): Promise<HelloResult> {
    this.gate("hello");
    // 特定レジストリを名乗る場合は対応 TLD もそのレジストリの部分集合にする
    const id = this.id;
    const tlds = id === "mock" ? [...SUPPORTED_TLDS] : [...REGISTRY_TLDS[id]];
    return { registry: id, tlds };
  }

  async check(names: string[]): Promise<CheckResult[]> {
    return this.recorded("check", null, { names }, () => this.doCheck(names));
  }

  private async doCheck(names: string[]): Promise<CheckResult[]> {
    this.gate("check");
    return names.map((name) => {
      const taken = this.domains.has(name.toLowerCase());
      return taken
        ? { name: name.toLowerCase(), available: false, reason: "in use" }
        : { name: name.toLowerCase(), available: true };
    });
  }

  async info(name: string): Promise<DomainInfo> {
    return this.recorded("info", name, { name }, () => this.doInfo(name));
  }

  private async doInfo(name: string): Promise<DomainInfo> {
    this.gate("info");
    return this.toInfo(this.getState(name, "info"));
  }

  async create(input: CreateInput): Promise<DomainInfo> {
    return this.recorded("create", input.name, { input }, () =>
      this.doCreate(input),
    );
  }

  private async doCreate(input: CreateInput): Promise<DomainInfo> {
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
      pendingTransfer: null,
    };
    this.domains.set(name, state);
    return this.toInfo(state);
  }

  async renew(name: string, input: RenewInput): Promise<DomainInfo> {
    return this.recorded("renew", name, { name, input }, () =>
      this.doRenew(name, input),
    );
  }

  private async doRenew(name: string, input: RenewInput): Promise<DomainInfo> {
    this.gate("renew");
    const state = this.getState(name, "renew");
    const statuses = deriveStatuses(state);
    if (
      state.pendingDelete ||
      state.pendingTransfer !== null ||
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
    return this.recorded("update", name, { name, input }, () =>
      this.doUpdate(name, input),
    );
  }

  private async doUpdate(
    name: string,
    input: UpdateInput,
  ): Promise<DomainInfo> {
    this.gate("update");
    const state = this.getState(name, "update");
    const removingOnly =
      !input.addNameservers?.length &&
      !input.removeNameservers?.length &&
      !input.addStatuses?.length &&
      (input.removeStatuses?.length ?? 0) > 0;
    if (
      state.pendingDelete ||
      state.pendingTransfer !== null ||
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
    return this.recorded("delete", name, { name }, () => this.doDelete(name));
  }

  private async doDelete(name: string): Promise<DeleteResult> {
    this.gate("delete");
    const state = this.getState(name, "delete");
    if (
      state.pendingDelete ||
      state.pendingTransfer !== null ||
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
    return this.recorded("restore", name, { name }, () => this.doRestore(name));
  }

  private async doRestore(name: string): Promise<DomainInfo> {
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
    // AuthCode はマスク対象キー（authInfo）で記録する（AC-15-2）
    return this.recorded(
      "transfer_request",
      name,
      { name, authInfo: authCode },
      () => this.doTransferRequest(name, authCode),
    );
  }

  private async doTransferRequest(
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
    if (state.pendingTransfer !== null) {
      throw new RegistryError({
        code: "OPERATION_NOT_ALLOWED",
        registry: this.id,
        message: `transfer:request: ${name} は既に移管申請中です`,
        registryCode: 2304,
      });
    }
    const requestedAt = this.now().toISOString();
    // 申請したのは自レジストラなので requesting = 自分、対応するのは相手レジストラ。
    state.pendingTransfer = {
      requestingRegistrarId: this.registrarId,
      actingRegistrarId: this.foreignRegistrarId,
      requestedAt,
      // 放置時のサーバ自動承認（FR-12。既定 20 分後）。
      actByAt: new Date(
        new Date(requestedAt).getTime() + TRANSFER_AUTO_APPROVE_MS,
      ).toISOString(),
    };
    state.upDate = requestedAt;
    return this.toTransferResult(
      state,
      "transfer_request",
      "pending",
      "pending",
      state.pendingTransfer,
    );
  }

  async transferQuery(name: string): Promise<TransferResult> {
    return this.recorded("transfer_query", name, { name }, () =>
      this.doTransferQuery(name),
    );
  }

  private async doTransferQuery(name: string): Promise<TransferResult> {
    this.gate("transfer:query");
    const state = this.getState(name, "transfer:query");
    // 実アダプタと同じく info 相当からの導出。移管中でなければレジストラ ID も日時も返さない。
    const pending = state.pendingTransfer;
    if (pending === null) {
      return {
        name: state.name,
        status: "none",
        raw: this.toTransferRaw("transfer_query", state),
      };
    }
    return this.toTransferResult(
      state,
      "transfer_query",
      "pending",
      "pending",
      pending,
    );
  }

  async transferApprove(name: string): Promise<TransferResult> {
    return this.recorded("transfer_approve", name, { name }, () =>
      this.doTransferApprove(name),
    );
  }

  /**
   * 移管の承認。実レジストリと同じく losing 側の操作で、承認するとドメインは申請側へ移る。
   * mock は 1 レジストラ分の状態しか持たないため「移管先へ渡した」ことを
   * `trDate`（最終移管日時）と Transfer GP で表し、`pendingTransfer` を解除する。
   * 有効期限は延ばさない（両レジストリの transfer 応答に exDate が無く、
   * 完了時に延びるかも未確認のため。ADR-0002 /【要確認: §21.2 #16】）。
   */
  private async doTransferApprove(name: string): Promise<TransferResult> {
    this.gate("transfer:approve");
    const state = this.getState(name, "transfer:approve");
    const pending = this.requirePending(state, "transfer:approve");
    const approvedAt = this.now().toISOString();
    state.pendingTransfer = null;
    state.trDate = approvedAt;
    state.rgpStatuses = [TRANSFER_GRACE_PERIOD];
    state.upDate = approvedAt;
    return this.toTransferResult(
      state,
      "transfer_approve",
      "approved",
      "clientApproved",
      pending,
    );
  }

  async transferReject(name: string): Promise<TransferResult> {
    return this.recorded("transfer_reject", name, { name }, () =>
      this.doTransferReject(name),
    );
  }

  /** 移管の拒否（losing 側）。申請を取り下げるだけで、ドメインの保有は変わらない。 */
  private async doTransferReject(name: string): Promise<TransferResult> {
    this.gate("transfer:reject");
    const state = this.getState(name, "transfer:reject");
    const pending = this.requirePending(state, "transfer:reject");
    state.pendingTransfer = null;
    state.upDate = this.now().toISOString();
    return this.toTransferResult(
      state,
      "transfer_reject",
      "rejected",
      "clientRejected",
      pending,
    );
  }

  async transferCancel(name: string): Promise<TransferResult> {
    return this.recorded("transfer_cancel", name, { name }, () =>
      this.doTransferCancel(name),
    );
  }

  /** 移管申請の取消（gaining 側）。承認前にだけ実行できる。 */
  private async doTransferCancel(name: string): Promise<TransferResult> {
    this.gate("transfer:cancel");
    const state = this.getState(name, "transfer:cancel");
    const pending = this.requirePending(state, "transfer:cancel");
    state.pendingTransfer = null;
    state.upDate = this.now().toISOString();
    return this.toTransferResult(
      state,
      "transfer_cancel",
      "cancelled",
      "clientCancelled",
      pending,
    );
  }

  /**
   * approve / reject / cancel は進行中の申請が前提。無ければ実レジストリの
   * 「転送リクエスト不在」（HTTP 409）に合わせて 2304 で拒否する。
   */
  private requirePending(
    state: MockDomainState,
    command: string,
  ): MockPendingTransfer {
    const pending = state.pendingTransfer;
    if (pending === null) {
      throw new RegistryError({
        code: "OPERATION_NOT_ALLOWED",
        registry: this.id,
        message: `${command}: ${state.name} に進行中の移管申請がありません`,
        registryCode: 2304,
      });
    }
    return pending;
  }

  /**
   * 移管系の正規化結果。`newExpiresAt` は設定しない（実レジストリの transfer 応答に
   * exDate が無く、mock だけが返すと mock でしか動かない実装を誘発するため。ADR-0002）。
   */
  private toTransferResult(
    state: MockDomainState,
    command: string,
    status: TransferStatus,
    registryStatus: string,
    pending: MockPendingTransfer,
  ): TransferResult {
    return {
      name: state.name,
      status,
      registryStatus,
      requestingRegistrarId: pending.requestingRegistrarId,
      actingRegistrarId: pending.actingRegistrarId,
      requestedAt: pending.requestedAt,
      actByAt: pending.actByAt,
      raw: this.toTransferRaw(command, state),
    };
  }

  /** `raw` に載せる状態スナップショット。JSON 化できるプレーン値だけを入れる。 */
  private toTransferRaw(
    command: string,
    state: MockDomainState,
  ): Record<string, unknown> {
    return {
      source: "mock",
      registry: this.id,
      command,
      domain: state.name,
      pendingTransfer: state.pendingTransfer !== null,
      statuses: deriveStatuses(state),
    };
  }

  async authCode(name: string): Promise<string> {
    // 応答の AuthCode 値がマスクされるよう authInfo キーで包んで記録する（AC-15-2）
    return this.recorded(
      "auth_info",
      name,
      { name },
      () => this.doAuthCode(name),
      (authInfo) => ({ authInfo }),
    );
  }

  private async doAuthCode(name: string): Promise<string> {
    this.gate("rotate-auth-info");
    const state = this.getState(name, "rotate-auth-info");
    state.authInfo = `mock-${randomUUID()}`;
    return state.authInfo;
  }
}
