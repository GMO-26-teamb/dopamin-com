/**
 * HTTP 実装（fe-ui 設計 §4.6）。`NEXT_PUBLIC_API_MODE=http` のときに使う。
 *
 * 各メソッドの上に docs/requirements.md §10.1 のルートを書く。
 * まだ API が無いルート（一覧・同期・AI・サブドメイン設計・ログ・設定・移管一覧）は
 * `NOT_IMPLEMENTED` を投げ、画面側は `toErrorCopy` の文言でその旨を出す。
 */

import {
  type DomainCheckRequest,
  deriveDisplayStatus,
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
import { notImplemented, toApiClientError } from "../errors";
import type { Services } from "../services";
import type { DomainDetail, SearchResult, Transfer } from "../types";
import {
  apiClient,
  authCodeSchema,
  checkResponseSchema,
  type DomainInfoResponse,
  domainEnvelopeSchema,
  nullableDomainEnvelopeSchema,
  transferEnvelopeSchema,
  unwrap,
} from "./client";

/**
 * `DomainInfo` を画面用の `DomainDetail` に写像する。
 *
 * 未取得の情報は API 側が未実装のため暫定値にする:
 * - `transfer.direction`: `info` は pendingTransfer の向きを返さない（移管一覧 API 待ち）
 * - `registrant`: `info` はコンタクト ID しか返さない（コンタクト取得 API 待ち）
 * - `gracePeriods`: `info` は RGP の期限を返さない
 * - `subdomainPlan`: 設計 API 未実装
 */
function toDomainDetail(info: DomainInfoResponse): DomainDetail {
  const { sld, tld } = splitDomainName(info.name);
  const ownership = "owned" as const;
  const transfer = null;
  return {
    name: info.name,
    sld,
    tld,
    registry: info.registry,
    statuses: info.statuses,
    rgpStatuses: info.rgpStatuses,
    ownership,
    displayStatus: deriveDisplayStatus({
      statuses: info.statuses,
      rgpStatuses: info.rgpStatuses,
      ownership,
      transfer,
    }),
    registeredAt: info.registeredAt,
    expiresAt: info.expiresAt,
    rgpUntil: null,
    syncedAt: new Date().toISOString(),
    stale: false,
    transfer,
    nameservers: info.nameservers,
    registrant: { name: info.registrant, email: "", migrated: true },
    gracePeriods: [],
    transferableFrom: transferEligibleAt(
      info.registeredAt,
      info.lastTransferAt,
    ),
    subdomainPlan: null,
  };
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
      /** GET /domains（FR-02、未実装） */
      list() {
        return Promise.reject(notImplemented("GET /domains"));
      },

      /** POST /domains/sync（FR-02、未実装） */
      sync() {
        return Promise.reject(notImplemented("POST /domains/sync"));
      },

      /** GET /domains/:name（FR-07） */
      async get(name) {
        const { domain } = await unwrap(
          apiClient.api.v1.domains[":name"].$get({ param: { name } }),
          domainEnvelopeSchema,
        );
        return toDomainDetail(domain);
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
        const { domain } = await unwrap(
          apiClient.api.v1.domains.$post({ json: input }),
          domainEnvelopeSchema,
        );
        return toDomainDetail(domain);
      },

      /** POST /domains/:name/renew（FR-08） */
      async renew(name, input) {
        const { domain } = await unwrap(
          apiClient.api.v1.domains[":name"].renew.$post({
            param: { name },
            json: input,
          }),
          domainEnvelopeSchema,
        );
        return toDomainDetail(domain);
      },

      /** PATCH /domains/:name（FR-09） */
      async update(name, input) {
        const { domain } = await unwrap(
          apiClient.api.v1.domains[":name"].$patch({
            param: { name },
            json: input,
          }),
          domainEnvelopeSchema,
        );
        return toDomainDetail(domain);
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
        const { domain } = await unwrap(
          apiClient.api.v1.domains[":name"].restore.$post({ param: { name } }),
          domainEnvelopeSchema,
        );
        return toDomainDetail(domain);
      },

      /**
       * FR-12: 移管 OUT 用 AuthCode。
       * §10.1 は POST だが、実装済みのルートは GET `/domains/:name/auth-code`
       * （呼ぶたびに rotate-auth-info で再発行される）。
       */
      async authCode(name) {
        const { authCode } = await unwrap(
          apiClient.api.v1.domains[":name"]["auth-code"].$get({
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
        return Promise.reject(notImplemented("POST /ai/domain-candidates"));
      },
    },

    subdomains: {
      /** GET /domains/:name/subdomain-plan（FR-13、未実装） */
      get() {
        return Promise.reject(
          notImplemented("GET /domains/:name/subdomain-plan"),
        );
      },
      /** POST /domains/:name/subdomain-plan（FR-13、未実装） */
      propose() {
        return Promise.reject(
          notImplemented("POST /domains/:name/subdomain-plan"),
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
      /** GET /auth/me + AI 設定（FR-17 の取得 API が未実装） */
      me() {
        return Promise.reject(notImplemented("GET /settings"));
      },
      /** PATCH /settings/ai（FR-17、未実装） */
      updateAi() {
        return Promise.reject(notImplemented("PATCH /settings/ai"));
      },
      /** POST /demo/reset（FR-16、未実装） */
      demoReset() {
        return Promise.reject(notImplemented("POST /demo/reset"));
      },
    },
  };
}
