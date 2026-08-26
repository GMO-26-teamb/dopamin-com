/**
 * HTTP 実装（fe-ui 設計 §4.6）。`NEXT_PUBLIC_API_MODE=http` のときに使う。
 *
 * 各メソッドの上に docs/requirements.md §10.1 のルートを書く。
 * まだ API が無いルート（AI・サブドメイン設計・ログ・デモリセット・移管一覧）は
 * `NOT_IMPLEMENTED` を投げ、画面側は `toErrorCopy` の文言でその旨を出す。
 */

import {
  aiSettingsResponseSchema,
  type DomainCheckRequest,
  deriveDisplayStatus,
  meResponseSchema,
  registryIdForDomain,
  splitDomainName,
} from "@dopamin/shared";
import {
  addPasskey,
  browserSupportsWebAuthn,
  deletePasskeyById,
  fetchPasskeys,
  loginWithPasskey,
  logout,
  signupWithPasskey,
} from "../../webauthn";
import { transferEligibleAt } from "../derive";
import { ApiClientError, notImplemented, toApiClientError } from "../errors";
import type { Services } from "../services";
import type {
  DomainDetail,
  DomainSummary,
  SearchResult,
  Transfer,
} from "../types";
import {
  type ApiDomainSummary,
  apiClient,
  authCodeSchema,
  checkResponseSchema,
  type DomainEnvelope,
  domainEnvelopeSchema,
  domainListSchema,
  domainSyncSchema,
  nullableDomainEnvelopeSchema,
  transferEnvelopeSchema,
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
 * `POST /domains/sync` の部分失敗を画面用のエラーにする（S-13 / AC-18-1）。
 *
 * API は 200 + `failures[]` で部分失敗を返すが、画面は「同期エラーの Banner を出しつつ
 * キャッシュ表示を続ける」= mutation を reject する契約なので、ここで例外に変換する。
 * 落ちたレジストリが 1 つに特定できるときだけ `registry` を載せ、見出しを具体名にする。
 */
function syncFailureError(
  failures: readonly { name: string; code: string; message: string }[],
): ApiClientError {
  const first = failures[0];
  const registries = new Set(
    failures
      .map((f) => registryIdForDomain(f.name))
      .filter((id) => id !== null),
  );
  const only = registries.size === 1 ? [...registries][0] : undefined;
  return new ApiClientError({
    // code は §10.3 の統一コード。zod で検証済みの値がそのまま入る
    code: (first?.code ?? "INTERNAL") as ApiClientError["code"],
    message: first?.message ?? "同期に失敗しました。",
    ...(only === undefined ? {} : { registry: only }),
  });
}

/** レジストリの移管ステータス文字列を画面用の状態に寄せる。 */
function toTransferStatus(raw: string): Transfer["status"] {
  const normalized = raw.toLowerCase();
  if (normalized.includes("approve")) {
    return "approved";
  }
  if (normalized.includes("reject")) {
    return "rejected";
  }
  if (normalized.includes("cancel")) {
    return "cancelled";
  }
  return "pending";
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

      /** POST /domains/sync（FR-02 最新化。部分失敗は例外に変換する） */
      async sync() {
        const { domains, failures } = await unwrap(
          apiClient.api.v1.domains.sync.$post(),
          domainSyncSchema,
        );
        if (failures.length > 0) {
          throw syncFailureError(failures);
        }
        return domains.map(toDomainSummaryVm);
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
            // 未対応 TLD は registry: null で返る。ViewModel は null を持てないため
            // 表示上のプレースホルダを入れる（当該行は必ず availability: "error"）。
            registry: result.registry ?? "mock",
            availability: result.availability,
            // FR-05 の独自性スコアは API 側が未実装（常に null）
            uniqueness: null,
            alternatives: [],
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
      /** POST /ai/domain-candidates（FR-04、未実装） */
      generate() {
        return Promise.reject(
          notImplemented("POST /ai/domain-candidates", "ai"),
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
      /** GET /transfers（FR-12、未実装） */
      list() {
        return Promise.reject(notImplemented("GET /transfers"));
      },
      /** GET /transfers（Poll 消化、未実装） */
      refresh() {
        return Promise.reject(notImplemented("GET /transfers"));
      },

      /** POST /transfers（FR-12 移管 IN 申請） */
      async request(input) {
        const { transfer } = await unwrap(
          apiClient.api.v1.transfers.$post({ json: input }),
          transferEnvelopeSchema,
        );
        const now = new Date().toISOString();
        const result: Transfer = {
          // 移管一覧 API（`GET /transfers`）が来るまで ID はドメイン名を使う
          id: transfer.name,
          domainName: transfer.name,
          // レジストリ応答に registry が無い（一覧 API で埋まる想定）
          registry: "mock",
          direction: "in",
          status: toTransferStatus(transfer.status),
          requestedAt: now,
          actByAt: null,
          completedAt: null,
        };
        return result;
      },

      /** POST /transfers/:id/approve（FR-12、未実装） */
      approve() {
        return Promise.reject(notImplemented("POST /transfers/:id/approve"));
      },
      /** POST /transfers/:id/reject（FR-12、未実装） */
      reject() {
        return Promise.reject(notImplemented("POST /transfers/:id/reject"));
      },
      /** POST /transfers/:id/cancel（FR-12、未実装） */
      cancel() {
        return Promise.reject(notImplemented("POST /transfers/:id/cancel"));
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
  };
}
