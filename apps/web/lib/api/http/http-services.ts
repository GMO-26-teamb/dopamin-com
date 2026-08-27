/**
 * HTTP 実装（fe-ui 設計 §4.6）。`NEXT_PUBLIC_API_MODE=http` のときに使う。
 *
 * 各メソッドの上に docs/requirements.md §10.1 のルートを書く。
 */

import {
  type AiLogItem,
  type DnsRecord as ApiDnsRecord,
  aiSettingsResponseSchema,
  aiTokenTotal,
  DEFAULT_REGISTRANT_PROFILE,
  type DesiredDnsRecord,
  type DnsZoneResponse,
  type DomainCheckRequest,
  type DomainCheckResult,
  type DomainSyncResponse,
  type DomainUniqueness,
  type DomainUpdateRequest,
  deriveDisplayStatus,
  meResponseSchema,
  type OperationLogItem,
  PAGINATION_MAX_LIMIT,
  registryIdForDomain,
  type SubdomainItem,
  type SubdomainPlanItem,
  type SubdomainPlanProposalResponse,
  type SubdomainPlanResponse,
  splitDomainName,
  type TransferSummary,
  type UniquenessPreviewRequest,
} from "@dopamin/shared";
import {
  addPasskey,
  browserSupportsWebAuthn,
  deletePasskeyById,
  fetchPasskeys,
  loginWithPasskey,
  logout,
  renamePasskeyById,
  signupWithPasskey,
} from "../../webauthn";
import { transferEligibleAt } from "../derive";
import {
  ApiClientError,
  type ClientErrorCode,
  toApiClientError,
  withErrorOrigin,
} from "../errors";
import { createMockPaymentService } from "../payments/mock-gateway";
import type { DomainUpdateInput, Services } from "../services";
import type {
  AiLog,
  ApplyStatus,
  Candidate,
  DnsDiff,
  DnsRecord,
  DomainDetail,
  DomainSummary,
  OperationLog,
  SearchResult,
  SubdomainHost,
  SubdomainPlan,
  SyncFailure,
  Transfer,
  UniquenessPreview,
  UniquenessScore,
} from "../types";
import {
  type ApiDomainSummary,
  aiLogsSchema,
  apiClient,
  authCodeSchema,
  candidatesResponseSchema,
  checkResponseSchema,
  type DomainEnvelope,
  demoResetSchema,
  dnsZoneSchema,
  domainEnvelopeSchema,
  domainListSchema,
  domainSyncSchema,
  nullableDomainEnvelopeSchema,
  operationLogsSchema,
  subdomainPlanApplySchema,
  subdomainPlanSchema,
  subdomainProposalSchema,
  transferEnvelopeSchema,
  transferSummaryEnvelopeSchema,
  transfersListSchema,
  uniquenessPreviewSchema,
  unwrap,
} from "./client";

/**
 * API の要約（`GET /domains` / 詳細の `summary`）を画面用の `DomainSummary` にする。
 * 足すのは `displayStatus` だけで、その導出は `packages/shared` が SSOT（fe-ui 設計 §4.1）。
 */
function toDomainSummaryVm(summary: ApiDomainSummary): DomainSummary {
  return {
    ...summary,
    displayStatus: deriveDisplayStatus({
      statuses: summary.statuses,
      rgpStatuses: summary.rgpStatuses,
      ownership: summary.ownership,
      transfer: summary.transfer,
    }),
  };
}

/**
 * 詳細応答（`{ domain, summary }`）を画面用の `DomainDetail` に写像する。
 *
 * 所有権・同期時刻・stale・移管バッジは `summary`（一覧と同じ要約）から取るので、
 * 一覧と詳細で表示がずれない。登録者は `registrantProfile` から取り、
 * サブドメイン設計の件数は `subdomainPlan` をそのまま使う（#217）。
 * `gracePeriods` だけは API がまだ返さない（`info` が猶予期限を持たない）ので空にする。
 */
function toDomainDetail({
  domain,
  summary,
  registrantProfile,
  subdomainPlan,
}: DomainEnvelope): DomainDetail {
  return {
    ...toDomainSummaryVm(summary),
    nameservers: domain.nameservers,
    // `domain.registrant` はレジストリのコンタクト ID なので画面には出さない。
    // 中身を知らない（= アプリのコンタクトを参照していない）ときは空にする。
    registrant: {
      name: registrantProfile?.name ?? "",
      email: registrantProfile?.email ?? "",
      // S-39 の判定は要確認 #14（非スポンサーの `contact info` 可否）が決まるまで保留
      migrated: true,
    },
    gracePeriods: [],
    transferableFrom: transferEligibleAt(
      domain.registeredAt,
      domain.lastTransferAt,
    ),
    subdomainPlan,
  };
}

/**
 * `DomainService.update` の入力（ViewModel）→ `PATCH /domains/:name` の body（FR-09）。
 *
 * 渡された項目だけを載せる。未変更の項目まで送ると、ロック解除だけの要求が
 * API の `unlockOnly` 経路（`clientUpdateProhibited` 中でも解除を通す）から外れる。
 *
 * `street` / `city` / `countryCode` は D-02 に入力欄が無いので
 * `DEFAULT_REGISTRANT_PROFILE`（レジストリが許可するダミー値）で埋める。
 * この 3 つを画面から編集させる予定は無いため、往復で保つ必要も無い。
 */
function toDomainUpdateBody(input: DomainUpdateInput): DomainUpdateRequest {
  return {
    ...(input.nameservers === undefined
      ? {}
      : { nameservers: input.nameservers }),
    ...(input.contacts === undefined
      ? {}
      : {
          contacts: {
            registrant: {
              ...DEFAULT_REGISTRANT_PROFILE,
              name: input.contacts.registrant.name,
              email: input.contacts.registrant.email,
            },
          },
        }),
    ...(input.clientStatuses === undefined
      ? {}
      : { clientStatuses: input.clientStatuses }),
  };
}

/**
 * `POST /domains/sync` の失敗 1 件を画面用にする（S-13 / AC-18-1）。
 *
 * API は 200 + `failures[]` で部分失敗を返す。ここで例外にはせず、落ちた相手を
 * 名前の TLD から引いて載せるだけにする（Banner の見出しを具体名にするため）。
 * 成功した行と失敗した行の両方を画面に出すのが S-13 の仕様なので、
 * ここで throw すると失敗行の `stale` がキャッシュに入らなくなる。
 */
function toSyncFailure(
  failure: DomainSyncResponse["failures"][number],
): SyncFailure {
  return { ...failure, registry: registryIdForDomain(failure.name) };
}

/**
 * API の独自性スコア（§10.4 の `uniqueness`）を画面用の `UniquenessScore` に写す。
 * `POST /domains/check` と `POST /uniqueness/preview` が同じ形を返すので写像は 1 か所。
 */
function toUniquenessVm(uniqueness: DomainUniqueness): UniquenessScore {
  return {
    score: uniqueness.score,
    label: uniqueness.label,
    nearest: uniqueness.topSimilar.map((t) => ({
      name: t.name,
      similarity: t.similarity,
    })),
  };
}

/**
 * `POST /domains/check` の 1 行（§10.4）を、画面用の共通フィールドに写す。
 *
 * 検索結果（`SearchResult`）と AI 候補（`Candidate`）は同じ `check` の形を共有するので、
 * レジストリ・空き状況・独自性スコアの写像はここ 1 か所に置く（FR-03 / FR-04 / FR-05）。
 */
function toCheckedFields(result: DomainCheckResult): {
  registry: SearchResult["registry"];
  availability: SearchResult["availability"];
  uniqueness: SearchResult["uniqueness"];
  alternatives: string[];
} {
  return {
    // 未対応 TLD は registry: null で返る。ViewModel は null を持てないため
    // 表示上のプレースホルダを入れる（当該行は必ず availability: "error"）。
    registry: result.registry ?? "mock",
    availability: result.availability,
    // FR-05: API の実スコアを ViewModel に写像する（topSimilar → nearest）
    uniqueness:
      result.uniqueness === null ? null : toUniquenessVm(result.uniqueness),
    alternatives: [],
  };
}

/**
 * `transfers` 行の要約（`packages/shared` の `TransferSummary`）を画面用 `Transfer` に写す。
 *
 * `import_pending`（承認済み・取り込み待ち）は API に無い画面専用の状態で、「IN の承認は
 * 検知したが `domains` への取り込みが未完了 = `domainId` が無い」を指す（§6.5）。
 * S-50 の「再試行」は `GET /transfers` の再照会で、サーバ側が取り込みを再試行する。
 */
function toTransferVm(summary: TransferSummary): Transfer {
  const importPending =
    summary.direction === "in" &&
    summary.status === "approved" &&
    summary.domainId === null;
  return {
    id: summary.id,
    domainName: summary.domainName,
    registry: summary.registry,
    direction: summary.direction,
    status: importPending ? "import_pending" : summary.status,
    // API は受理時刻で埋めるため実質必ず入る。欠けたら履歴の日付表示用に確定時刻で代替する
    requestedAt:
      summary.requestedAt ?? summary.completedAt ?? summary.actByAt ?? "",
    actByAt: summary.actByAt,
    completedAt: summary.completedAt,
  };
}

// ---------------------------------------------------------------------------
// サブドメイン設計（FR-13）
// ---------------------------------------------------------------------------

/**
 * API の反映状態（`applyState`）を画面の `applyStatus` に写す。
 * 呼び名が違うだけで意味は 1:1（`unapplied` = まだ疑似 DNS ゾーンに無い）。
 */
const APPLY_STATUS_BY_STATE: Record<
  SubdomainPlanItem["applyState"],
  ApplyStatus
> = {
  unapplied: "pending",
  applied: "applied",
  changed: "changed",
};

/**
 * 設計の 1 項目を画面用の `SubdomainHost` にする。
 *
 * API は項目に ID を振らないので、ホスト名をそのまま ID に使う。設計内でホストは
 * 一意（`savedSubdomainProposalSchema` の `hasUniqueHosts`）なので衝突せず、
 * 保存で採番し直されることもない。編集で追加した行の `draft-n`（`nextHostId`）は
 * 保存応答でホスト名の ID に置き換わる。
 */
function toSubdomainHost(
  item: SubdomainItem,
  applyStatus: ApplyStatus,
): SubdomainHost {
  return {
    id: item.host,
    host: item.host,
    purpose: item.purpose,
    recordType: item.recordType,
    target: item.target,
    priority: item.priority,
    applyStatus,
  };
}

/**
 * 保存済み設計（`GET` / `PUT` の応答）を画面用の `SubdomainPlan` にする。
 *
 * `nameserversSwitched` は `appliedAt` から導く。反映（`POST .../apply`）は NS 切替を
 * **先に**行い、切り替えられなければレコードを 1 件も変えずに失敗する（AC-13-5）。
 * つまり `appliedAt` が入っている = 反映が通った = NS はドパ民 DNS、が成り立つ。
 * 設計の応答は NS を返さないので、ここで `GET /domains/:name` を足すとレジストリ
 * 呼び出しが 1 回増える（S-43 を開くたび）ため、この導出で代える。
 * レジストリ側で NS を戻された場合だけ実態とずれるが、その状態で反映すると
 * 切替からやり直されるので実害は無い。
 */
function toSubdomainPlanVm(plan: SubdomainPlanResponse): SubdomainPlan {
  return {
    domain: plan.domain,
    repoUrl: plan.repoUrl,
    policy: plan.policy,
    hosts: plan.items.map((item) =>
      toSubdomainHost(item, APPLY_STATUS_BY_STATE[item.applyState]),
    ),
    nameserversSwitched: plan.appliedAt !== null,
    savedAt: plan.savedAt,
    appliedAt: plan.appliedAt,
  };
}

/**
 * 保存前の提案（`POST` の応答）を画面用の `SubdomainPlan` にする。
 * まだ保存していないので反映状態は一律「未反映」で、`savedAt` / `appliedAt` は null。
 * 画面は `savedAt === null` を未保存と見なし、反映の前に「設計を保存」を要求する。
 */
function toProposedPlanVm(
  proposal: SubdomainPlanProposalResponse,
): SubdomainPlan {
  return {
    domain: proposal.domain,
    repoUrl: proposal.repoUrl,
    policy: proposal.policy,
    hosts: proposal.items.map((item) => toSubdomainHost(item, "pending")),
    nameserversSwitched: false,
    savedAt: null,
    appliedAt: null,
  };
}

/**
 * FR-13 の提案で「相手は AI だった」と言い切れる統一エラーコード（§10.3）。
 *
 * 提案は GitHub 解析 → AI の 2 段で、前段の失敗は `NOT_FOUND`（S-42。画面は概要入力を開く・
 * AC-13-2）として返る。`RATE_LIMITED` は GitHub と AI のどちらでも返るため相手を断定できず、
 * ここには入れない（概要入力に倒れる = 手が残る方に寄せる）。
 */
const AI_FAILURE_CODES: ReadonlySet<ClientErrorCode> = new Set<ClientErrorCode>(
  ["AI_UNAVAILABLE", "REGISTRY_TIMEOUT", "REGISTRY_UNAVAILABLE"],
);

/** AI 由来の失敗にだけ `origin: "ai"` を付ける（S-41 の Banner Warn + 再試行）。 */
function toProposeError(error: unknown): ApiClientError {
  const clientError = toApiClientError(error);
  return AI_FAILURE_CODES.has(clientError.code)
    ? withErrorOrigin(clientError, "ai")
    : clientError;
}

/** `GET /domains/:name/subdomain-plan`（保存済み設計）。未保存なら 404。 */
function getSubdomainPlan(domain: string): Promise<SubdomainPlanResponse> {
  return unwrap(
    apiClient.api.v1.domains[":name"]["subdomain-plan"].$get({
      param: { name: domain },
    }),
    subdomainPlanSchema,
  );
}

/**
 * 未保存（404）を `null` にして返す版。S-40（設計なし → リポジトリ解析へ誘導）は
 * 例外ではなく空の状態なので、`SubdomainService.get` の契約は `null` になっている。
 */
async function findSubdomainPlan(
  domain: string,
): Promise<SubdomainPlanResponse | null> {
  try {
    return await getSubdomainPlan(domain);
  } catch (error) {
    if (error instanceof ApiClientError && error.code === "NOT_FOUND") {
      return null;
    }
    throw error;
  }
}

/** 疑似 DNS ゾーンのレコードを画面用にする（差分ダイアログの「変更前」表示）。 */
function toDnsRecordVm(record: ApiDnsRecord | DesiredDnsRecord): DnsRecord {
  return {
    host: record.host,
    recordType: record.recordType,
    target: record.target,
    ttl: record.ttl,
  };
}

/**
 * `GET /domains/:name/dns` の差分を画面用の `DnsDiff` にする（S-44）。
 *
 * API の差分はレコード（host / recordType / target / ttl）だけで、用途・重要度を持たない。
 * ダイアログは `SubdomainHost` を受け取る形なので、保存済み設計の項目をホスト名で
 * 引き当てて埋める。差分の `added` / `changed.desired` は設計から導かれたレコードなので
 * 必ず引き当たる（引き当たらない場合だけ最小限の値で埋める）。
 */
function toDnsDiffVm(
  diff: DnsZoneResponse["diff"],
  items: readonly SubdomainPlanItem[],
): DnsDiff {
  const itemByHost = new Map(items.map((item) => [item.host, item]));
  const toHost = (
    record: DesiredDnsRecord,
    applyStatus: ApplyStatus,
  ): SubdomainHost => {
    const item = itemByHost.get(record.host);
    return {
      id: record.host,
      host: record.host,
      purpose: item?.purpose ?? "",
      recordType: record.recordType,
      target: record.target,
      priority: item?.priority ?? "optional",
      applyStatus,
    };
  };

  return {
    added: diff.added.map((record) => toHost(record, "pending")),
    updated: diff.changed.map((change) => ({
      host: toHost(change.desired, "changed"),
      previous: toDnsRecordVm(change.current),
    })),
    removed: diff.removed.map(toDnsRecordVm),
    unchanged: diff.unchanged.map((record) => record.host),
  };
}

// ---------------------------------------------------------------------------
// ログ（FR-14 / FR-15）
// ---------------------------------------------------------------------------

/**
 * ログ一覧で 1 回に取る件数。
 *
 * `LogService`（fe-ui 設計 §4.2）は `Promise<OperationLog[]>` を返す 1 ページ契約で、
 * 「もっと見る」（S-60 / S-61）は取得済みの配列をクライアント側で刻んで出している。
 * カーソルを辿る口が無いぶん、1 回で API の上限まで取る。
 */
const LOG_FETCH_LIMIT = String(PAGINATION_MAX_LIMIT);

/** 操作ログ 1 件を画面用にする（`requestId` は画面に出さないので落とす）。 */
function toOperationLogVm(item: OperationLogItem): OperationLog {
  return {
    id: item.id,
    at: item.at,
    command: item.command,
    registry: item.registry,
    domainName: item.domainName,
    status: item.status,
    errorCode: item.errorCode,
    registryCode: item.registryCode,
    latencyMs: item.latencyMs,
    request: item.request,
    response: item.response,
  };
}

/**
 * AI ログ 1 件を画面用にする。表示するトークン数は入出力の合計で、
 * 導出は `packages/shared` の `aiTokenTotal` が SSOT（どちらも無ければ null）。
 * 失敗時の本文は `outputSummary` に入っているので `errorMessage` は落とす。
 */
function toAiLogVm(item: AiLogItem): AiLog {
  return {
    id: item.id,
    at: item.at,
    feature: item.feature,
    provider: item.provider,
    model: item.model,
    inputSummary: item.inputSummary,
    outputSummary: item.outputSummary,
    status: item.status,
    latencyMs: item.latencyMs,
    tokens: aiTokenTotal(item.tokensIn, item.tokensOut),
    raw: item.output,
  };
}

/**
 * `GET /transfers`（FR-12）。Poll 消化と `transferQuery` による最新化はサーバ側で走る
 * （§10.1「表示時に Poll を消化」）ので、クライアントは取得して平坦化するだけ。
 * 区画（IN / OUT / 履歴）への振り分けは `groupTransfers`（画面側）がやり直す。
 */
async function fetchTransfers(): Promise<Transfer[]> {
  const groups = await unwrap(
    apiClient.api.v1.transfers.$get(),
    transfersListSchema,
  );
  return [...groups.outbound, ...groups.inbound, ...groups.history].map(
    toTransferVm,
  );
}

export function createHttpServices(): Services {
  return {
    auth: {
      isSupported: () => browserSupportsWebAuthn(),

      /** POST /auth/passkey/register/options + /verify */
      async signup(displayName) {
        try {
          return await signupWithPasskey(displayName);
        } catch (e) {
          throw toApiClientError(e);
        }
      },

      /** POST /auth/passkey/login/options + /verify */
      async login() {
        try {
          return await loginWithPasskey();
        } catch (e) {
          throw toApiClientError(e);
        }
      },

      /** POST /auth/logout */
      async logout() {
        try {
          await logout();
        } catch (e) {
          throw toApiClientError(e);
        }
      },

      /** POST /auth/passkeys/register/options + /verify */
      async addPasskey() {
        try {
          return await addPasskey();
        } catch (e) {
          throw toApiClientError(e);
        }
      },

      /** GET /auth/passkeys */
      async listPasskeys() {
        try {
          return await fetchPasskeys();
        } catch (e) {
          throw toApiClientError(e);
        }
      },

      /** DELETE /auth/passkeys/:id */
      async deletePasskey(id) {
        try {
          await deletePasskeyById(id);
        } catch (e) {
          throw toApiClientError(e);
        }
      },

      /** PATCH /auth/passkeys/:id */
      async renamePasskey(id, name) {
        try {
          return await renamePasskeyById(id, name);
        } catch (e) {
          throw toApiClientError(e);
        }
      },
    },

    domains: {
      /** GET /domains（FR-02 保有一覧。DB キャッシュを読むだけでレジストリは叩かない） */
      async list() {
        const { domains } = await unwrap(
          apiClient.api.v1.domains.$get(),
          domainListSchema,
        );
        return domains.map(toDomainSummaryVm);
      },

      /**
       * POST /domains/sync（FR-02 最新化）。
       * 部分失敗は 200 のまま `failures` に載せて返す。失敗した行は API 側で
       * `stale: true` になっているので、そのままキャッシュに書けば S-13 の
       * 「失敗したカードだけ Stale」が成立する。
       */
      async sync() {
        const { domains, failures } = await unwrap(
          apiClient.api.v1.domains.sync.$post(),
          domainSyncSchema,
        );
        return {
          domains: domains.map(toDomainSummaryVm),
          failures: failures.map(toSyncFailure),
        };
      },

      /** GET /domains/:name（FR-07。失敗時は stale なキャッシュが返る・AC-07-2） */
      async get(name) {
        return toDomainDetail(
          await unwrap(
            apiClient.api.v1.domains[":name"].$get({ param: { name } }),
            domainEnvelopeSchema,
          ),
        );
      },

      /** POST /domains/check（FR-03 / 05） */
      async check(input: DomainCheckRequest) {
        const { results } = await unwrap(
          apiClient.api.v1.domains.check.$post({ json: input }),
          checkResponseSchema,
        );
        return results.map((result): SearchResult => {
          const { sld, tld } = splitDomainName(result.name);
          return {
            name: result.name,
            sld,
            tld,
            ...toCheckedFields(result),
            error:
              result.error === undefined
                ? null
                : { ...result.error, retryable: false },
          };
        });
      },

      /** POST /domains（FR-06） */
      async register(input) {
        return toDomainDetail(
          await unwrap(
            apiClient.api.v1.domains.$post({ json: input }),
            domainEnvelopeSchema,
          ),
        );
      },

      /** POST /domains/:name/renew（FR-08） */
      async renew(name, input) {
        return toDomainDetail(
          await unwrap(
            apiClient.api.v1.domains[":name"].renew.$post({
              param: { name },
              json: input,
            }),
            domainEnvelopeSchema,
          ),
        );
      },

      /** PATCH /domains/:name（FR-09） */
      async update(name, input) {
        return toDomainDetail(
          await unwrap(
            apiClient.api.v1.domains[":name"].$patch({
              param: { name },
              json: toDomainUpdateBody(input),
            }),
            domainEnvelopeSchema,
          ),
        );
      },

      /** DELETE /domains/:name（FR-10）。RGP 入りなら domain が返り、即時削除なら null。 */
      async remove(name) {
        const { domain } = await unwrap(
          apiClient.api.v1.domains[":name"].$delete({ param: { name } }),
          nullableDomainEnvelopeSchema,
        );
        const inRgp =
          domain !== null &&
          (domain.statuses.includes("pendingDelete") ||
            domain.rgpStatuses.includes("redemptionPeriod"));
        return { outcome: inRgp ? "rgp" : "deleted" };
      },

      /** POST /domains/:name/restore（FR-11） */
      async restore(name) {
        return toDomainDetail(
          await unwrap(
            apiClient.api.v1.domains[":name"].restore.$post({
              param: { name },
            }),
            domainEnvelopeSchema,
          ),
        );
      },

      /**
       * FR-12: 移管 OUT 用 AuthCode（POST /domains/:name/auth-code、§10.1）。
       * 呼ぶたびに rotate-auth-info で再発行されるため、前回表示した値は無効になる。
       */
      async authCode(name) {
        const { authCode } = await unwrap(
          apiClient.api.v1.domains[":name"]["auth-code"].$post({
            param: { name },
          }),
          authCodeSchema,
        );
        return { authCode };
      },
    },

    uniqueness: {
      /**
       * POST /uniqueness/preview（FR-05）。ランディング S-00 のお試しスコア。
       * ログイン前に叩くので `unwrap` の 401 経路には乗らない（そもそも認証を見ない）。
       */
      async preview(
        input: UniquenessPreviewRequest,
      ): Promise<UniquenessPreview> {
        const { sld, uniqueness } = await unwrap(
          apiClient.api.v1.uniqueness.preview.$post({ json: input }),
          uniquenessPreviewSchema,
        );
        return { sld, uniqueness: toUniquenessVm(uniqueness) };
      },
    },

    candidates: {
      /**
       * POST /ai/domain-candidates（FR-04 / §10.1）。
       *
       * API は候補 1 件ごとに空き確認（FR-03）と独自性スコア（FR-05）を載せた `check` を
       * 返すので、検索結果と同じ `toCheckedFields` で写す（AC-04-1）。
       * 失敗は AI 側の相手として扱い、`REGISTRY_TIMEOUT` などの共用コードでも
       * AI 向けの文言が出るようにする（S-23）。
       */
      async generate(input) {
        const { candidates } = await unwrap(
          apiClient.api.v1.ai["domain-candidates"].$post({ json: input }),
          candidatesResponseSchema,
          "ai",
        );
        return candidates.map(
          (candidate): Candidate => ({
            sld: candidate.sld,
            tld: candidate.tld,
            reason: candidate.reason,
            ...toCheckedFields(candidate.check),
          }),
        );
      },
    },

    subdomains: {
      /**
       * GET /domains/:name/subdomain-plan（FR-13 / AC-13-3・AC-13-6）。
       * 未保存は 404 で返るが、画面にとっては S-40（設計なし）の空状態なので `null` にする。
       */
      async get(domain) {
        const plan = await findSubdomainPlan(domain);
        return plan === null ? null : toSubdomainPlanVm(plan);
      },

      /**
       * POST /domains/:name/subdomain-plan（FR-13 / AC-13-1・AC-13-2）。
       * リポジトリ解析 → AI 提案で、**保存はしない**（保存は `save`）。
       * 失敗した相手で画面の出方が変わるため `toProposeError` で切り分ける（S-41 / S-42）。
       */
      async propose(domain, input) {
        const proposal = await unwrap(
          apiClient.api.v1.domains[":name"]["subdomain-plan"].$post({
            param: { name: domain },
            json: input,
          }),
          subdomainProposalSchema,
        ).catch((error: unknown) => {
          throw toProposeError(error);
        });
        return toProposedPlanVm(proposal);
      },

      /**
       * PUT /domains/:name/subdomain-plan（FR-13 / AC-13-3）。
       * 送るのは設計そのものだけ。`applyStatus` は保存後にサーバーが疑似 DNS ゾーンと
       * 突き合わせて返し直す（AC-13-6）ので、画面が持っていた値は載せない。
       */
      async save(domain, plan) {
        const saved = await unwrap(
          apiClient.api.v1.domains[":name"]["subdomain-plan"].$put({
            param: { name: domain },
            json: {
              policy: plan.policy,
              items: plan.hosts.map((host) => ({
                host: host.host,
                purpose: host.purpose,
                recordType: host.recordType,
                target: host.target,
                priority: host.priority,
              })),
              // 提案なしで手書きした設計は repoUrl を持たない（スキーマ上も任意）
              ...(plan.repoUrl ? { repoUrl: plan.repoUrl } : {}),
            },
          }),
          subdomainPlanSchema,
        );
        return toSubdomainPlanVm(saved);
      },

      /**
       * GET /domains/:name/dns（FR-13 / AC-13-7）。
       * 差分の計算はサーバー側（`diffDnsRecords`）が SSOT で、確認ダイアログと
       * 実際の反映がずれないようにしている。設計は用途・重要度を埋めるために併せて引く。
       */
      async diff(domain) {
        const [zone, plan] = await Promise.all([
          unwrap(
            apiClient.api.v1.domains[":name"].dns.$get({
              param: { name: domain },
            }),
            dnsZoneSchema,
          ),
          findSubdomainPlan(domain),
        ]);
        return toDnsDiffVm(zone.diff, plan?.items ?? []);
      },

      /**
       * POST /domains/:name/subdomain-plan/apply（FR-13 / AC-13-4・AC-13-5）。
       * 応答は件数だけなので、反映後の設計（`applyState` / `appliedAt`）を取り直して返す。
       * NS を切り替えられなかった場合はここが失敗し、レコードも設計も変わらない（S-46）。
       */
      async apply(domain) {
        const result = await unwrap(
          apiClient.api.v1.domains[":name"]["subdomain-plan"].apply.$post({
            param: { name: domain },
          }),
          subdomainPlanApplySchema,
        );
        return {
          ...result,
          plan: toSubdomainPlanVm(await getSubdomainPlan(domain)),
        };
      },
    },

    transfers: {
      /** GET /transfers（FR-12 / AC-12-1 / AC-12-3） */
      list() {
        return fetchTransfers();
      },
      /** S-50「最新化」。GET /transfers 自体が Poll 消化 + 再照会を伴う（§10.1） */
      refresh() {
        return fetchTransfers();
      },

      /** POST /transfers（FR-12 移管 IN 申請） */
      async request(input) {
        // `transfer`（レジストリ応答の DTO）もスキーマで検証するが、画面に返すのは
        // 永続化された `record`。id が uuid になり、取消（POST /transfers/:id/cancel）に使える
        const { record } = await unwrap(
          apiClient.api.v1.transfers.$post({ json: input }),
          transferEnvelopeSchema,
        );
        return toTransferVm(record);
      },

      /** POST /transfers/:id/approve（FR-12 / AC-12-4。受信した OUT 申請の承認） */
      async approve(id) {
        const { transfer } = await unwrap(
          apiClient.api.v1.transfers[":id"].approve.$post({ param: { id } }),
          transferSummaryEnvelopeSchema,
        );
        return toTransferVm(transfer);
      },
      /** POST /transfers/:id/reject（FR-12 / AC-12-4。受信した OUT 申請の拒否） */
      async reject(id) {
        const { transfer } = await unwrap(
          apiClient.api.v1.transfers[":id"].reject.$post({ param: { id } }),
          transferSummaryEnvelopeSchema,
        );
        return toTransferVm(transfer);
      },
      /** POST /transfers/:id/cancel（FR-12。自分の IN 申請の取消） */
      async cancel(id) {
        const { transfer } = await unwrap(
          apiClient.api.v1.transfers[":id"].cancel.$post({ param: { id } }),
          transferSummaryEnvelopeSchema,
        );
        return toTransferVm(transfer);
      },
    },

    logs: {
      /** GET /logs/operations（FR-15 / AC-15-2。自分のログを新しい順に 1 ページ） */
      async operations() {
        const { items } = await unwrap(
          apiClient.api.v1.logs.operations.$get({
            query: { limit: LOG_FETCH_LIMIT },
          }),
          operationLogsSchema,
        );
        return items.map(toOperationLogVm);
      },

      /** GET /logs/ai（FR-14 / AC-14-1。成功・失敗の両方が載る） */
      async ai() {
        const { items } = await unwrap(
          apiClient.api.v1.logs.ai.$get({ query: { limit: LOG_FETCH_LIMIT } }),
          aiLogsSchema,
        );
        return items.map(toAiLogVm);
      },
    },

    settings: {
      /**
       * GET /auth/me（FR-01 / FR-16 / FR-17、requirements §10.1）。
       * `MeResponse`（packages/shared）は ViewModel `Me`（types.ts）と同じ形なので写像しない。
       */
      me() {
        return unwrap(apiClient.api.v1.auth.me.$get(), meResponseSchema);
      },

      /** PATCH /settings/ai（FR-17）。更新後の実効値が返る */
      updateAi(input) {
        return unwrap(
          apiClient.api.v1.settings.ai.$patch({ json: input }),
          aiSettingsResponseSchema,
        );
      },

      /**
       * POST /demo/reset（FR-16 / AC-16-1）。
       * 無効な環境では 404 が返る（`GET /auth/me` の `features.demoReset` が false なら
       * 画面はカード自体を出さない）。作り直したドメイン名は画面が使わないので捨てる。
       */
      async demoReset() {
        await unwrap(apiClient.api.v1.demo.reset.$post(), demoResetSchema);
      },
    },

    /**
     * 決済（FR-19）は API にルートが無く、HTTP モードでもブラウザ内のモックで完結させる。
     * 実 PSP を繋ぐときは `payments/mock-gateway.ts` を差し替える（契約は同じ）。
     */
    payments: createMockPaymentService({ delayMs: 800 }),
  };
}
