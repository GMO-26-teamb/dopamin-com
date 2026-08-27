/**
 * HTTP 実装（fe-ui 設計 §4.6）。`NEXT_PUBLIC_API_MODE=http` のときに使う。
 *
 * 各メソッドの上に docs/requirements.md §10.1 のルートを書く。
 * まだ API が無いルート（AI・サブドメイン設計・ログ・デモリセット）は
 * `NOT_IMPLEMENTED` を投げ、画面側は `toErrorCopy` の文言でその旨を出す。
 */

import {
  aiSettingsResponseSchema,
  type DomainCheckRequest,
  type DomainCheckResult,
  type DomainSyncResponse,
  deriveDisplayStatus,
  meResponseSchema,
  registryIdForDomain,
  splitDomainName,
  type TransferSummary,
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
import { notImplemented, toApiClientError } from "../errors";
import { createMockPaymentService } from "../payments/mock-gateway";
import type { Services } from "../services";
import type {
  Candidate,
  DomainDetail,
  DomainSummary,
  SearchResult,
  SyncFailure,
  Transfer,
} from "../types";
import {
  type ApiDomainSummary,
  apiClient,
  authCodeSchema,
  candidatesResponseSchema,
  checkResponseSchema,
  type DomainEnvelope,
  domainEnvelopeSchema,
  domainListSchema,
  domainSyncSchema,
  nullableDomainEnvelopeSchema,
  transferEnvelopeSchema,
  transferSummaryEnvelopeSchema,
  transfersListSchema,
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
 * 一覧と詳細で表示がずれない。まだ API が返さない値は暫定のままにする:
 * - `registrant`: `info` はコンタクト ID しか返さない（コンタクト取得 API 待ち）
 * - `gracePeriods`: `info` は猶予期限を返さない（§11.4 の目安計算は未実装）
 * - `subdomainPlan`: 設計 API（FR-13）未実装
 */
function toDomainDetail({ domain, summary }: DomainEnvelope): DomainDetail {
  return {
    ...toDomainSummaryVm(summary),
    nameservers: domain.nameservers,
    registrant: { name: domain.registrant, email: "", migrated: true },
    gracePeriods: [],
    transferableFrom: transferEligibleAt(
      domain.registeredAt,
      domain.lastTransferAt,
    ),
    subdomainPlan: null,
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
      result.uniqueness === null
        ? null
        : {
            score: result.uniqueness.score,
            label: result.uniqueness.label,
            nearest: result.uniqueness.topSimilar.map((t) => ({
              name: t.name,
              similarity: t.similarity,
            })),
          },
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
        if (input.contacts !== undefined) {
          // 要件 §10.1 の PATCH は `contacts` を受け取る想定だが、
          // `domainUpdateRequestSchema`（packages/shared）にはまだ無い（要確認 #14）。
          throw notImplemented("PATCH /domains/:name（contacts）");
        }
        return toDomainDetail(
          await unwrap(
            apiClient.api.v1.domains[":name"].$patch({
              param: { name },
              json: { nameservers: input.nameservers },
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
      /** GET /domains/:name/subdomain-plan（FR-13、未実装） */
      get() {
        return Promise.reject(
          notImplemented("GET /domains/:name/subdomain-plan"),
        );
      },
      /** POST /domains/:name/subdomain-plan（FR-13、AI 提案。未実装） */
      propose() {
        return Promise.reject(
          notImplemented("POST /domains/:name/subdomain-plan", "ai"),
        );
      },
      /** PUT /domains/:name/subdomain-plan（FR-13、未実装） */
      save() {
        return Promise.reject(
          notImplemented("PUT /domains/:name/subdomain-plan"),
        );
      },
      /** GET /domains/:name/dns（FR-13、未実装） */
      diff() {
        return Promise.reject(notImplemented("GET /domains/:name/dns"));
      },
      /** POST /domains/:name/subdomain-plan/apply（FR-13、未実装） */
      apply() {
        return Promise.reject(
          notImplemented("POST /domains/:name/subdomain-plan/apply"),
        );
      },
    },

    transfers: {
      /** GET /transfers（FR-12 / AC-12-1 / AC-12-3） */
      list() {
        return fetchTransfers();
      },
      /** S-50「状態を更新」。GET /transfers 自体が Poll 消化 + 再照会を伴う（§10.1） */
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
      /** GET /logs/operations（FR-15、未実装） */
      operations() {
        return Promise.reject(notImplemented("GET /logs/operations"));
      },
      /** GET /logs/ai（FR-14、未実装） */
      ai() {
        return Promise.reject(notImplemented("GET /logs/ai"));
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

      /** POST /demo/reset（FR-16、未実装） */
      demoReset() {
        return Promise.reject(notImplemented("POST /demo/reset"));
      },
    },

    /**
     * 決済（FR-19）は API にルートが無く、HTTP モードでもブラウザ内のモックで完結させる。
     * 実 PSP を繋ぐときは `payments/mock-gateway.ts` を差し替える（契約は同じ）。
     */
    payments: createMockPaymentService({ delayMs: 800 }),
  };
}
