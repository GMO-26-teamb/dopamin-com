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
  type PollMessage,
  type PollMessageType,
  type RegistrantProfile,
  type RegistryId,
  type RenewInput,
  TRANSFER_AUTO_APPROVE_MS,
  type TransferResult,
  type TransferStatus,
  type UpdateInput,
} from "@dopamin/shared";
import type { RegistryAdapter } from "./adapter";
import { RegistryError } from "./errors";
import type {
  MockDomainState,
  MockPendingTransfer,
  MockPollMessage,
  MockStateSnapshot,
  MockStateStore,
} from "./mock-store";
import type { ClTridFactory, RegistryCallObserver } from "./observer";
import { REGISTRY_TLDS, SUPPORTED_TLDS } from "./routing";

/** エラーシミュレーション用の失敗モード（docs/requirements.md §11.6）。 */
export type MockFailMode =
  | "none"
  | "timeout"
  | "5xx"
  | "reject"
  | "spec_mismatch"
  /**
   * 更新系だけを「レジストリには届いたが応答がタイムアウトした」状態にする（#49。§11.6 (d)）。
   * `timeout` はコマンドの手前で落ちるので状態が変わらず、`info` も失敗するため、
   * AC-18-2（タイムアウト後に参照系で結果を照合する）を手元で再現できない。
   * こちらは**状態を変えてから** `REGISTRY_TIMEOUT` を投げ、参照系は通す。
   */
  | "timeout_after_write";

function addYears(iso: string, years: number): string {
  const date = new Date(iso);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString();
}

/** ステータスは状態から決定的に導出する（ok は他ステータスと排他）。 */
function deriveStatuses(state: MockDomainState): string[] {
  if (state.pendingDelete) {
    // RGP 中は EPP 仕様（RFC 3915）上 pendingDelete と共存する。実レジストリ（kitaqsign 実測）
    // も statuses 側に redemptionPeriod を載せるので、mock も同じ形にする（#171）
    return state.rgpStatuses.includes("redemptionPeriod")
      ? ["pendingDelete", "redemptionPeriod"]
      : ["pendingDelete"];
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

/** 移管の確定 → その事実を伝える Poll 通知の種別（ADR-0002 決定 9）。 */
const POLL_TYPE_BY_OUTCOME: Record<TransferOutcome, PollMessageType> = {
  approved: "transfer_approved",
  rejected: "transfer_rejected",
  cancelled: "transfer_cancelled",
};

/**
 * 状態を変えない参照系コマンド（`failMode=timeout_after_write` の対象外）。
 * ここに無いものは「更新系」とみなす（コマンドが増えたときに素通りさせないため、
 * 除外リストではなく参照系の列挙にしている）。
 */
const READ_COMMANDS: ReadonlySet<OperationCommand> = new Set([
  "hello",
  "check",
  "info",
  "transfer_query",
  "poll",
  "host_info",
]);

/** 移管が確定したときの結果（`pending` / `none` を除いた `TransferStatus`）。 */
type TransferOutcome = "approved" | "rejected" | "cancelled";

/**
 * 移管を確定させた主体。通知は「行為者以外の当事者」に積む
 * （自分で承認したことは自分に通知されない。サーバ自動承認は双方に届く）。
 */
type TransferActor = "self" | "foreign" | "server";

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
  /** 放置された移管申請をサーバが自動承認するまでのミリ秒（§17 MOCK_TRANSFER_AUTO_APPROVE_MS）。 */
  private readonly autoApproveMs: number;
  private domains = new Map<string, MockDomainState>();
  /** レジストリ側に作られたコンタクト（ID → プロファイル）。 */
  private contacts = new Map<string, RegistrantProfile>();
  /**
   * レジストラ ID ごとの Poll キュー（FIFO）。相手レジストラ側のキューも持つ:
   * `poll()` からは読めないが、「申請が相手に届いた」状態を表現するために積む。
   */
  private pollQueues = new Map<string, MockPollMessage[]>();
  /** メッセージ ID の採番（レジストリの int64 に相当。数字だけの文字列で持つ）。 */
  private nextMessageId = 1;
  private readonly now: () => Date;
  private failMode: MockFailMode;
  private readonly onCall?: RegistryCallObserver;
  private readonly makeClTrid?: ClTridFactory;
  private readonly store?: MockStateStore;
  /**
   * ストア併用時の直列化（このインスタンス内）。`recorded()` の
   * hydrate → 実行 → persist を 1 単位として並べる。並行リクエストの hydrate が
   * 「変更済み・未 persist」の状態を消すと、変更検知（before 比較）まで一致して
   * 成功応答を返した書き込みが黙って失われるため。
   * インスタンスを跨ぐ競合は従来どおり後勝ち（mock-store.ts の割り切り）。
   */
  private storeQueue: Promise<unknown> = Promise.resolve();

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
    /**
     * 放置時にサーバが自動承認するまでのミリ秒（既定 20 分 = `TRANSFER_AUTO_APPROVE_MS`）。
     * タイマーではなく `info` / `transferQuery` / `poll` 時の遅延評価で効かせるため、
     * テストでは 0 を渡して「期限が来ている」状態を作れる。
     */
    autoApproveMs?: number;
    failMode?: MockFailMode;
    now?: () => Date;
    /** 操作ログ（FR-15）用の観測フック。公開メソッド 1 回 = 1 レコード。 */
    onCall?: RegistryCallObserver;
    /** clTRID の採番上書き。null 返却時は既定の採番。 */
    makeClTrid?: ClTridFactory;
    /**
     * 状態の永続化（#46）。渡すと公開メソッドの前後で状態を読み書きし、
     * プロセスをまたいでも状態が残る（Vercel Functions のインスタンス跨ぎ）。
     * 未指定ならプロセス内 Map に閉じる（従来どおり）。
     */
    store?: MockStateStore;
  }) {
    this.id = options?.id ?? "mock";
    this.registrarId = options?.registrarId ?? MOCK_REGISTRAR_ID;
    this.foreignRegistrarId =
      options?.foreignRegistrarId ?? MOCK_FOREIGN_REGISTRAR_ID;
    this.autoApproveMs = options?.autoApproveMs ?? TRANSFER_AUTO_APPROVE_MS;
    this.failMode = options?.failMode ?? "none";
    this.now = options?.now ?? (() => new Date());
    this.onCall = options?.onCall;
    this.makeClTrid = options?.makeClTrid;
    this.store = options?.store;
  }

  /** テスト・デモリセット用に失敗モードを切り替える。 */
  setFailMode(mode: MockFailMode): void {
    this.failMode = mode;
  }

  /**
   * ストアから状態を読み込む（#46）。ストア未設定なら何もしない。
   *
   * 公開メソッドの入口で毎回読み直すので、別インスタンス・別リクエストで
   * 書かれた状態が見える。**読み込み単位はスナップショット全体**（デモ用途で
   * 扱う件数が小さいため、部分読み出しの複雑さを持ち込まない）。
   */
  async hydrate(): Promise<void> {
    if (!this.store) {
      return;
    }
    const snapshot = await this.store.load();
    this.domains.clear();
    this.pollQueues.clear();
    this.contacts.clear();
    if (snapshot === null) {
      this.nextMessageId = 1;
      return;
    }
    for (const domain of snapshot.domains) {
      this.domains.set(domain.name, domain);
    }
    for (const [registrarId, queue] of Object.entries(snapshot.queues)) {
      this.pollQueues.set(registrarId, queue);
    }
    for (const [id, profile] of Object.entries(snapshot.contacts)) {
      this.contacts.set(id, profile);
    }
    this.nextMessageId = snapshot.nextMessageId;
  }

  /**
   * 現在の状態のスナップショット（永続化とその差分判定に使う）。
   * 空のキューは落として正規化する: `poll()` は読むだけでもキューの入れ物を作るので、
   * そのまま比べると参照系が「変更あり」に見えてしまう。
   */
  private snapshot(): MockStateSnapshot {
    return {
      domains: [...this.domains.values()],
      queues: Object.fromEntries(
        [...this.pollQueues].filter(([, queue]) => queue.length > 0),
      ),
      contacts: Object.fromEntries(this.contacts),
      nextMessageId: this.nextMessageId,
    };
  }

  /**
   * 現在の状態をストアに書き戻す（#46）。ストア未設定なら何もしない。
   *
   * `seedForeignDomain` / `simulate*`（レジストリ操作ではないシミュレーション API）は
   * 同期関数なので自動では永続化されない。ストアを使う場合は呼び出し後にこれを await する。
   */
  async persist(): Promise<void> {
    if (!this.store) {
      return;
    }
    await this.store.save(this.snapshot());
  }

  /**
   * 公開メソッド 1 回 = 1 レコードで観測フックを呼ぶ（FR-15）。
   * 実レジストリと違い HTTP 往復が無いため svTrid は null。補助コマンドのうち
   * `hello` / `contact_create` / `contact_update` は mock でも独立した行になるが、
   * ホストオブジェクトを持たないので `host_info` / `host_create` は発行しない。
   * observer の失敗はレジストリ操作の成否に影響させない。
   *
   * ストアがある場合は、この単位で状態を読み込み → 実行 → 書き戻す（#46）。
   * **失敗した場合も書き戻す**: mock は失敗の途中で状態を変えることがあり
   * （`timeout_after_write` 等）、破棄すると実レジストリとの乖離が大きくなるため。
   */
  private async recorded<T>(
    command: OperationCommand,
    domainName: string | null,
    request: unknown,
    run: () => Promise<T>,
    toResponse: (result: T) => unknown = (result) => result,
  ): Promise<T> {
    const fn = () => this.withPostWriteTimeout(command, run);
    if (this.store) {
      return this.serialized(async () => {
        await this.hydrate();
        // 参照系（check / info / hello / poll の空振り）は状態を変えないので書き戻さない。
        // /health は定期的に叩かれるため、変わっていないのに毎回書くと無駄が積み上がる。
        // 変更の有無はスナップショットの比較で見る（変更点を各所で追うより崩れにくい）
        const before = JSON.stringify(this.snapshot());
        try {
          return await this.record(
            command,
            domainName,
            request,
            fn,
            toResponse,
          );
        } finally {
          if (JSON.stringify(this.snapshot()) !== before) {
            await this.persist();
          }
        }
      });
    }
    return this.record(command, domainName, request, fn, toResponse);
  }

  /** {@link storeQueue} に載せて順番に実行する。前の失敗は後続に伝播させない。 */
  private serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = this.storeQueue.then(task);
    this.storeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * `failMode=timeout_after_write`（§11.6 (d) / AC-18-2）。
   *
   * 更新系は**状態を変えてから**タイムアウトさせる。「レジストリには届いたが応答が
   * 返ってこなかった」状況の再現で、`reconcileOnTimeout` が参照系で結果を照合して
   * 成功に確定できることを手元で確認するために要る（`failMode=timeout` は
   * コマンドの手前で落ちるので状態が変わらず、照合先の `info` も失敗する）。
   * 参照系は素通しする（照合ができないと再現の意味が無い）。
   */
  private async withPostWriteTimeout<T>(
    command: OperationCommand,
    run: () => Promise<T>,
  ): Promise<T> {
    const result = await run();
    if (
      this.failMode === "timeout_after_write" &&
      !READ_COMMANDS.has(command)
    ) {
      throw new RegistryError({
        code: "REGISTRY_TIMEOUT",
        registry: this.id,
        message: `${command}: モックレジストリが応答を返しませんでした（failMode=timeout_after_write。コマンドは反映済み）`,
      });
    }
    return result;
  }

  private async record<T>(
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
      // 個々の検証はどのコマンドから呼ばれたかを知らないので、ここで補う。
      // result code ごとの文言の出し分け（userMessageForRegistryCode）が command を見る
      throw error === null ? err : error.withCommand(command);
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
      // timeout_after_write はコマンドの手前では落とさない（実行後に throw する）
      default:
        return;
    }
  }

  /**
   * 状態を引く前に、期限の来た移管申請をサーバ自動承認として確定させる。
   * `info` / `transferQuery` を含むすべてのコマンドがここを通るので、
   * 「参照した時点で最新」になる（遅延評価の理由は {@link settleDueTransfer}）。
   */
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
    this.settleDueTransfer(state);
    return state;
  }

  /**
   * 自動承認の遅延評価。`setTimeout` を使わないのは Vercel Functions では
   * レスポンス後に関数がフリーズしてタイマーが生き残らないため（§11.1 / FR-12）。
   * 代わりに状態を読むたび（`info` / `transferQuery` / `poll`）に期限を判定する。
   */
  private settleDueTransfer(state: MockDomainState): void {
    const pending = state.pendingTransfer;
    if (pending === null) {
      return;
    }
    if (this.now().getTime() < new Date(pending.actByAt).getTime()) {
      return;
    }
    // 放置された申請はサーバが承認する。行為者がサーバなので当事者双方に通知が積まれる
    this.settleTransfer(state, pending, "approved", "serverApproved", "server");
  }

  /** レジストラ ID の Poll キュー（無ければ作る）。 */
  private queueFor(registrarId: string): MockPollMessage[] {
    const existing = this.pollQueues.get(registrarId);
    if (existing) {
      return existing;
    }
    const created: MockPollMessage[] = [];
    this.pollQueues.set(registrarId, created);
    return created;
  }

  /** 通知を 1 件積む（FIFO の末尾）。 */
  private enqueue(
    registrarId: string,
    type: PollMessageType,
    state: MockDomainState,
    transfer: TransferResult,
  ): void {
    this.queueFor(registrarId).push({
      id: String(this.nextMessageId),
      type,
      domainName: state.name,
      queuedAt: this.now().toISOString(),
      transfer,
    });
    this.nextMessageId += 1;
  }

  /** 申請日時 → 自動承認の期限。 */
  private actByAt(requestedAt: string): string {
    return new Date(
      new Date(requestedAt).getTime() + this.autoApproveMs,
    ).toISOString();
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
      // 内部では sponsoringRegistrarId を持つが、実レジストリの info 応答に clID が
      // 無いので mock も返さない（ADR-0002 決定 4。mock でだけ動く実装を防ぐため）。
      // 移管 OUT の検知は Poll 通知（transfer_approved）から行う。
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
    // 呼び出し側が用意したコンタクトがあれば参照する（#72 の再利用）
    const registrant =
      input.registrantContactId ?? `mock-${randomUUID().slice(0, 8)}`;
    const state: MockDomainState = {
      name,
      sponsoringRegistrarId: this.registrarId,
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

  /**
   * テスト・デモ用: **自レジストラが保有する**ドメインを任意の状態で投入する（§11.1 / FR-16）。
   *
   * `create` は「今つくったドメイン」しか作れない（`exDate` は必ず登録時 + 期間、
   * `rgpStatuses` は `addPeriod` 固定）ため、FR-16 のデモデータが要求する
   * 「期限間近」「RGP 中」といった**途中の状態**を再現できない。
   * 実レジストリでも同じことは頼めないので、mock 側のシミュレーション API として持つ。
   *
   * レジストリ操作ではなくシミュレーションの下ごしらえなので操作ログは発行しない。
   * ストアを使う場合は呼び出し後に {@link persist} を await すること。
   */
  seedOwnedDomain(
    name: string,
    options?: {
      /** 登録日時（既定は現在時刻）。`exDate` はここから `periodYears` 後になる。 */
      registeredAt?: string;
      /** 登録期間（年。既定 1）。「期限間近」は `registeredAt` を過去にして作る。 */
      periodYears?: number;
      /** 空にすると `inactive` が付く（`deriveStatuses`）。 */
      nameservers?: readonly string[];
      clientStatuses?: readonly ClientStatus[];
      /** 例: `["redemptionPeriod"]`。`pendingDelete` と組み合わせて RGP 中を作る。 */
      rgpStatuses?: readonly string[];
      pendingDelete?: boolean;
      authInfo?: string;
    },
  ): DomainInfo {
    const key = name.toLowerCase();
    if (this.domains.has(key)) {
      throw new RegistryError({
        code: "CONFLICT",
        registry: this.id,
        message: `seedOwnedDomain: ${key} は既に存在します`,
        registryCode: 2302,
      });
    }
    const crDate = options?.registeredAt ?? this.now().toISOString();
    const registrant = `mock-${randomUUID().slice(0, 8)}`;
    const state: MockDomainState = {
      name: key,
      sponsoringRegistrarId: this.registrarId,
      registrant,
      contacts: { TECH: registrant },
      nameservers: options?.nameservers ? [...options.nameservers] : [],
      clientStatuses: options?.clientStatuses
        ? [...options.clientStatuses]
        : [],
      crDate,
      upDate: null,
      exDate: addYears(crDate, options?.periodYears ?? 1),
      trDate: null,
      rgpStatuses: options?.rgpStatuses ? [...options.rgpStatuses] : [],
      authInfo: options?.authInfo ?? `mock-${randomUUID().slice(0, 8)}`,
      pendingDelete: options?.pendingDelete ?? false,
      pendingTransfer: null,
    };
    this.domains.set(key, state);
    return this.toInfo(state);
  }

  /**
   * テスト・デモ用: **相手レジストラが保有する**ドメインを投入する（§11.1 / FR-16）。
   *
   * 移管 IN（`transferRequest` → 相手の承認）の対象になる。`create` で作った
   * ドメインは自レジストラ保有なので移管 IN の対象にできない（自分から自分への
   * 移管は成立しない）ため、IN 側のシナリオはこの seed から始める。
   *
   * レジストリ操作ではなくシミュレーションの下ごしらえなので操作ログは発行しない。
   */
  seedForeignDomain(
    name: string,
    authInfo: string,
    options?: {
      /** 相手レジストラが掛けているロック（例: `clientTransferProhibited`）。 */
      clientStatuses?: readonly ClientStatus[];
      /** 登録からの経過を作りたいときの登録日時（既定は現在時刻）。 */
      registeredAt?: string;
    },
  ): DomainInfo {
    const key = name.toLowerCase();
    if (this.domains.has(key)) {
      throw new RegistryError({
        code: "CONFLICT",
        registry: this.id,
        message: `seedForeignDomain: ${key} は既に存在します`,
        registryCode: 2302,
      });
    }
    const crDate = options?.registeredAt ?? this.now().toISOString();
    const registrant = `foreign-${randomUUID().slice(0, 8)}`;
    const state: MockDomainState = {
      name: key,
      sponsoringRegistrarId: this.foreignRegistrarId,
      registrant,
      // 相手レジストラ発行のコンタクト ID を参照したままになる（FR-12 の取り込み後の課題）
      contacts: { TECH: registrant },
      nameservers: [`ns1.${key}`],
      clientStatuses: options?.clientStatuses
        ? [...options.clientStatuses]
        : [],
      crDate,
      upDate: null,
      exDate: addYears(crDate, 1),
      trDate: null,
      rgpStatuses: [],
      authInfo,
      pendingDelete: false,
      pendingTransfer: null,
    };
    this.domains.set(key, state);
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
    this.requireSponsor(state, "renew");
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
    this.requireSponsor(state, "update");
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

    // 登録者は置換（EPP の chg.registrant）、ロール別コンタクトは差分（add.contacts）
    if (input.registrant !== undefined) {
      state.registrant = input.registrant;
    }
    if (input.contacts) {
      state.contacts = { ...state.contacts, ...input.contacts };
    }
    state.upDate = this.now().toISOString();
    return this.toInfo(state);
  }

  async delete(name: string): Promise<DeleteResult> {
    return this.recorded("delete", name, { name }, () => this.doDelete(name));
  }

  private async doDelete(name: string): Promise<DeleteResult> {
    this.gate("delete");
    const state = this.getState(name, "delete");
    this.requireSponsor(state, "delete");
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
    this.requireSponsor(state, "restore");
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

  /**
   * 移管 IN の申請（gaining 側 = 自レジストラ）。対象は**相手レジストラ保有**の
   * ドメインだけで、自レジストラ保有のドメインへの申請は拒否する（自分から自分への
   * 移管は成立しないため）。受理すると `pendingTransfer` になり、相手側の Poll に
   * `transfer_request` が積まれる（spec-notes §1「移管フロー」）。
   */
  private async doTransferRequest(
    name: string,
    authCode: string,
  ): Promise<TransferResult> {
    this.gate("transfer:request");
    const state = this.getState(name, "transfer:request");
    if (state.sponsoringRegistrarId === this.registrarId) {
      // 実レジストリが返す result code は未確認【要確認: §21.2 #15】。
      // 「現在の状態では実行できない」と読める 2304 を暫定で使う（判明したら差し替える）。
      throw new RegistryError({
        code: "OPERATION_NOT_ALLOWED",
        registry: this.id,
        message: `transfer:request: ${name} は既に自レジストラの保有です`,
        registryCode: 2304,
      });
    }
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
    // 申請したのは自レジストラなので requesting = 自分、対応するのは現スポンサー。
    const pending: MockPendingTransfer = {
      requestingRegistrarId: this.registrarId,
      actingRegistrarId: state.sponsoringRegistrarId,
      requestedAt,
      // 放置時のサーバ自動承認（FR-12。既定 20 分後）。
      actByAt: this.actByAt(requestedAt),
    };
    state.pendingTransfer = pending;
    state.upDate = requestedAt;
    const result = this.toTransferResult(
      state,
      "transfer_request",
      "pending",
      "pending",
      pending,
    );
    this.enqueue(pending.actingRegistrarId, "transfer_request", state, result);
    return result;
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
   * 移管の承認（移管 OUT の確定）。実レジストリと同じく losing 側 = 対応側の操作で、
   * 承認するとスポンサーが申請側（相手レジストラ）へ移り、`trDate`（最終移管日時）と
   * Transfer GP が付く。有効期限は延ばさない（両レジストリの transfer 応答に exDate が
   * 無く、完了時に延びるかも未確認のため。ADR-0002 /【要確認: §21.2 #16】）。
   */
  private async doTransferApprove(name: string): Promise<TransferResult> {
    this.gate("transfer:approve");
    const state = this.getState(name, "transfer:approve");
    const pending = this.requirePending(state, "transfer:approve", "acting");
    return this.settleTransfer(
      state,
      pending,
      "approved",
      "clientApproved",
      "self",
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
    const pending = this.requirePending(state, "transfer:reject", "acting");
    return this.settleTransfer(
      state,
      pending,
      "rejected",
      "clientRejected",
      "self",
    );
  }

  async transferCancel(name: string): Promise<TransferResult> {
    return this.recorded("transfer_cancel", name, { name }, () =>
      this.doTransferCancel(name),
    );
  }

  /** 移管申請の取消（gaining 側 = 申請側）。承認前にだけ実行できる。 */
  private async doTransferCancel(name: string): Promise<TransferResult> {
    this.gate("transfer:cancel");
    const state = this.getState(name, "transfer:cancel");
    const pending = this.requirePending(state, "transfer:cancel", "requesting");
    return this.settleTransfer(
      state,
      pending,
      "cancelled",
      "clientCancelled",
      "self",
    );
  }

  /**
   * approve / reject / cancel は進行中の申請が前提。無ければ実レジストリの
   * 「転送リクエスト不在」（HTTP 409）に合わせて 2304 で拒否する。
   *
   * さらに役割も見る: approve / reject は対応側（losing）、cancel は申請側（gaining）
   * だけが実行できる。役割違いは実レジストリの「操作権限なし」（HTTP 403）に合わせ、
   * EPP の Authorization error（2201）で拒否する（spec-notes §1「移管フロー」）。
   */
  private requirePending(
    state: MockDomainState,
    command: string,
    role: "acting" | "requesting",
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
    const permitted =
      role === "acting"
        ? pending.actingRegistrarId
        : pending.requestingRegistrarId;
    if (permitted !== this.registrarId) {
      throw new RegistryError({
        code: "REGISTRY_REJECTED",
        registry: this.id,
        message: `${command}: ${state.name} の移管でこの操作を行う権限がありません`,
        registryCode: 2201,
      });
    }
    return pending;
  }

  /**
   * 更新系は現スポンサーだけが実行できる。相手レジストラ保有のドメイン
   * （seed 直後・移管 OUT 完了後）への書き込みは実レジストリと同じく
   * 「操作権限なし」（2201）で拒否する。
   *
   * `info` は制限しない: 非スポンサーからの応答が 2201 なのか限定情報なのかが
   * 未確認で【要確認: §21.2 #12】、移管 IN の完了検知（FR-12）が `info` に依存するため。
   */
  private requireSponsor(state: MockDomainState, command: string): void {
    if (state.sponsoringRegistrarId !== this.registrarId) {
      throw new RegistryError({
        code: "REGISTRY_REJECTED",
        registry: this.id,
        message: `${command}: ${state.name} は自レジストラの保有ではありません`,
        registryCode: 2201,
      });
    }
  }

  /**
   * 移管の確定（承認 / 拒否 / 取消）。承認ならスポンサーが申請側へ移り、
   * `trDate` と Transfer GP が付く。拒否・取消は申請を消すだけで保有は動かない。
   *
   * 通知は「行為者以外の当事者」の Poll キューへ積む。自分の approve が自分に
   * 通知されることはなく、サーバ自動承認（行為者 = server）だけが双方に届く。
   * gaining 側にも通知が積まれるかは実レジストリでは未確認【要確認: §21.2 #13】だが、
   * 積まれない前提だと移管 IN の完了を Poll で検知できないため積む側に倒す。
   */
  private settleTransfer(
    state: MockDomainState,
    pending: MockPendingTransfer,
    outcome: TransferOutcome,
    registryStatus: string,
    actor: TransferActor,
  ): TransferResult {
    const settledAt = this.now().toISOString();
    state.pendingTransfer = null;
    state.upDate = settledAt;
    if (outcome === "approved") {
      state.sponsoringRegistrarId = pending.requestingRegistrarId;
      state.trDate = settledAt;
      state.rgpStatuses = [TRANSFER_GRACE_PERIOD];
    }
    const result = this.toTransferResult(
      state,
      `transfer_${outcome}`,
      outcome,
      registryStatus,
      pending,
    );
    const actorRegistrarId =
      actor === "self"
        ? this.registrarId
        : actor === "foreign"
          ? this.foreignRegistrarId
          : null;
    const involved = new Set([
      pending.requestingRegistrarId,
      pending.actingRegistrarId,
    ]);
    for (const registrarId of involved) {
      if (registrarId !== actorRegistrarId) {
        this.enqueue(registrarId, POLL_TYPE_BY_OUTCOME[outcome], state, result);
      }
    }
    return result;
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

  /**
   * コンタクトの作成（§11.1）。実レジストリと同じく ID はアダプタが採番する。
   * 内容は保持するだけで、mock のドメイン状態（`registrant` / `contacts`）は
   * ID で参照する。
   */
  async createContact(profile: RegistrantProfile): Promise<string> {
    return this.recorded("contact_create", null, { profile }, () =>
      this.doCreateContact(profile),
    );
  }

  private async doCreateContact(profile: RegistrantProfile): Promise<string> {
    this.gate("contact:create");
    const id = `C-${randomUUID().slice(0, 8)}`;
    this.contacts.set(id, { ...profile });
    return id;
  }

  async updateContact(id: string, profile: RegistrantProfile): Promise<void> {
    return this.recorded("contact_update", null, { id, profile }, () =>
      this.doUpdateContact(id, profile),
    );
  }

  private async doUpdateContact(
    id: string,
    profile: RegistrantProfile,
  ): Promise<void> {
    this.gate("contact:update");
    if (!this.contacts.has(id)) {
      throw new RegistryError({
        code: "NOT_FOUND",
        registry: this.id,
        message: `contact:update: コンタクト ${id} は存在しません`,
        registryCode: 2303,
      });
    }
    this.contacts.set(id, { ...profile });
  }

  /** テスト用: 保持しているコンタクトの内容を覗く（レジストリ操作ではない）。 */
  peekContact(id: string): RegistrantProfile | undefined {
    const stored = this.contacts.get(id);
    return stored ? { ...stored } : undefined;
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
    // 移管 OUT 用の AuthCode は現スポンサーだけが再発行できる
    this.requireSponsor(state, "rotate-auth-info");
    state.authInfo = `mock-${randomUUID()}`;
    return state.authInfo;
  }

  async poll(): Promise<PollMessage | null> {
    // 対象ドメインは通知を読むまで決まらないため、実アダプタと同じく domainName は null
    return this.recorded("poll", null, null, () => this.doPoll());
  }

  /**
   * 最古の未 ack 通知を 1 件返す（無ければ null）。ack するまで同じ通知が返り続ける
   * FIFO で、実レジストリと同じく自動失効はしない（spec-notes §1「非同期通知（Poll）」）。
   */
  private async doPoll(): Promise<PollMessage | null> {
    this.gate("poll");
    // 期限の来た申請をここでも確定させる（poll は getState を通らないため）
    for (const state of this.domains.values()) {
      this.settleDueTransfer(state);
    }
    const queue = this.queueFor(this.registrarId);
    const message = queue[0];
    if (!message) {
      return null;
    }
    return {
      id: message.id,
      // 未 ack の残件数。返した 1 件も未 ack なので含める（EPP の msgQ count と同じ数え方）
      count: queue.length,
      queuedAt: message.queuedAt,
      type: message.type,
      domainName: message.domainName,
      transfer: message.transfer,
      raw: {
        source: "mock",
        registry: this.id,
        command: "poll",
        id: message.id,
        msgType: message.type,
        domain: message.domainName,
        qdate: message.queuedAt,
        count: queue.length,
      },
    };
  }

  async ackMessage(id: string): Promise<void> {
    return this.recorded("ack", null, { id }, () => this.doAck(id));
  }

  /** 通知の消し込み。存在しない ID は実レジストリの「メッセージ不在」に合わせて 2303。 */
  private async doAck(id: string): Promise<void> {
    this.gate("ack");
    const queue = this.queueFor(this.registrarId);
    const index = queue.findIndex((message) => message.id === id);
    if (index < 0) {
      throw new RegistryError({
        code: "NOT_FOUND",
        registry: this.id,
        message: `ack: メッセージ ${id} は存在しません`,
        registryCode: 2303,
      });
    }
    queue.splice(index, 1);
  }

  // ---- 移管シミュレーション（テスト・デモ用。§11.1 / §19 / FR-16）----
  // レジストリ操作ではなく「相手レジストラが動いた」ことにする API なので、
  // 操作ログ（FR-15）は発行しない。自分が出した呼び出しではないため。

  /**
   * 相手レジストラから自保有ドメインへの移管申請を受信したことにする
   * （移管 OUT の起点。AC-12-4）。自分の Poll キューに `transfer_request` が積まれる。
   */
  simulateInboundTransferRequest(name: string): TransferResult {
    const command = "simulate:inbound-request";
    const state = this.getState(name, command);
    this.requireSponsor(state, command);
    // 受信側の申請でも、レジストリが弾く条件は `transferRequest` と同じ
    if (
      state.pendingDelete ||
      state.clientStatuses.includes("clientTransferProhibited")
    ) {
      throw new RegistryError({
        code: "OPERATION_NOT_ALLOWED",
        registry: this.id,
        message: `${command}: ${state.name} は現在のステータスでは移管できません`,
        registryCode: 2304,
      });
    }
    if (state.pendingTransfer !== null) {
      throw new RegistryError({
        code: "OPERATION_NOT_ALLOWED",
        registry: this.id,
        message: `${command}: ${state.name} は既に移管申請中です`,
        registryCode: 2304,
      });
    }
    const requestedAt = this.now().toISOString();
    const pending: MockPendingTransfer = {
      requestingRegistrarId: this.foreignRegistrarId,
      actingRegistrarId: this.registrarId,
      requestedAt,
      actByAt: this.actByAt(requestedAt),
    };
    state.pendingTransfer = pending;
    state.upDate = requestedAt;
    const result = this.toTransferResult(
      state,
      "transfer_request",
      "pending",
      "pending",
      pending,
    );
    this.enqueue(this.registrarId, "transfer_request", state, result);
    return result;
  }

  /**
   * 相手レジストラが自分の移管申請を承認したことにする（移管 IN 完了。AC-12-3）。
   * ドメインは自レジストラ保有になり、自分の Poll に `transfer_approved` が積まれる。
   */
  simulateCounterpartApprove(name: string): TransferResult {
    return this.simulateCounterpartAct(
      name,
      "approved",
      "clientApproved",
      "simulate:counterpart-approve",
    );
  }

  /** 相手レジストラが自分の移管申請を拒否したことにする（移管 IN の拒否。AC-12-2 の相手側）。 */
  simulateCounterpartReject(name: string): TransferResult {
    return this.simulateCounterpartAct(
      name,
      "rejected",
      "clientRejected",
      "simulate:counterpart-reject",
    );
  }

  /**
   * 相手レジストラが対応側（losing）として申請を処理する共通実装。
   * 相手が対応側でない（= 自分が losing の移管 OUT）場合は、承認 / 拒否は
   * `transferApprove` / `transferReject` の役目なので拒否する。
   */
  private simulateCounterpartAct(
    name: string,
    outcome: Extract<TransferOutcome, "approved" | "rejected">,
    registryStatus: string,
    command: string,
  ): TransferResult {
    const state = this.getState(name, command);
    const pending = state.pendingTransfer;
    if (pending === null) {
      throw new RegistryError({
        code: "OPERATION_NOT_ALLOWED",
        registry: this.id,
        message: `${command}: ${state.name} に進行中の移管申請がありません`,
        registryCode: 2304,
      });
    }
    if (pending.actingRegistrarId !== this.foreignRegistrarId) {
      throw new RegistryError({
        code: "OPERATION_NOT_ALLOWED",
        registry: this.id,
        message: `${command}: ${state.name} の移管で対応側は相手レジストラではありません`,
        registryCode: 2304,
      });
    }
    return this.settleTransfer(
      state,
      pending,
      outcome,
      registryStatus,
      "foreign",
    );
  }
}
