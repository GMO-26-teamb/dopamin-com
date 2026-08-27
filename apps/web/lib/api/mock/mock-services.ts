/**
 * モック実装（fe-ui 設計 §4.4）。既定のデータ取得はこれ。
 *
 * `?mock=<scenario>` で全画面の状態（空 / 読み込み / エラー / 機能固有）を再現する。
 * 表示用の値は必ず `packages/shared` の導出ロジック（`deriveDisplayStatus` /
 * `isDopaminNameservers` / `uniquenessLabel`）から作り、ここで EPP ステータスを再解釈しない。
 */

import {
  DOPAMIN_NAMESERVERS,
  type DomainCheckRequest,
  deriveDisplayStatus,
  isDopaminNameservers,
  type PasskeySummary,
  passkeyNameSchema,
  splitDomainName,
  uniquenessLabel,
} from "@dopamin/shared";
import { ApiClientError, type ErrorOrigin } from "../errors";
import { createMockPaymentService } from "../payments/mock-gateway";
import type { DomainUpdateInput, Services } from "../services";
import type {
  Candidate,
  DnsDiff,
  DnsRecord,
  DomainDetail,
  DomainSummary,
  SearchResult,
  SubdomainHost,
  SubdomainPlan,
  SyncResult,
  Transfer,
  UniquenessScore,
} from "../types";
import { at, days, minutes, mockRegistryForName } from "./fixtures";
import { defaultDelayMs, type MockScenario } from "./scenario";
import { getMockStore, type MockStore, resetMockStore } from "./store";

export { resetMockStore };

function delay(ms: number): Promise<void> {
  return ms <= 0
    ? Promise.resolve()
    : new Promise((resolve) => setTimeout(resolve, ms));
}

/** モックの「現在時刻」。fixtures と同じ基準を使い、更新後の表示も決定的にする。 */
function nowIso(): string {
  return at(0);
}

function fail(
  code: ApiClientError["code"],
  message: string,
  extra: {
    origin?: ErrorOrigin;
    registry?: DomainSummary["registry"];
    registryCode?: string;
  } = {},
): never {
  throw new ApiClientError({ code, message, ...extra });
}

/** AI 呼び出しの失敗。文言を AI 向けに出し分けるため origin を付ける（S-23 / S-41）。 */
function failAi(code: ApiClientError["code"], message: string): never {
  fail(code, message, { origin: "ai" });
}

const registryUnavailable = (
  registry: DomainSummary["registry"] = "kitaqsign",
) =>
  fail("REGISTRY_UNAVAILABLE", "レジストリに接続できませんでした。", {
    registry,
  });

/** 文字列から 0〜100 の決定的な値を作る（空き判定・スコアのゆらぎ用）。 */
function pseudoScore(seed: string): number {
  let hash = 7;
  for (const char of seed) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 1009;
  }
  return hash % 101;
}

/** `similarity` は 0〜1（API と同じ単位）。ここでは百分率から換算する。 */
function similarityFromPercent(percent: number): number {
  return percent / 100;
}

function uniquenessFor(name: string): UniquenessScore {
  const { sld, tld } = splitDomainName(name);
  const value = pseudoScore(name);
  return {
    score: value,
    label: uniquenessLabel(value),
    nearest: [
      {
        name: `${sld}s.${tld}`,
        similarity: similarityFromPercent(90 - (value % 12)),
      },
      {
        name: `${sld}-app.${tld}`,
        similarity: similarityFromPercent(78 - (value % 15)),
      },
      {
        name: `the${sld}.${tld}`,
        similarity: similarityFromPercent(63 - (value % 18)),
      },
    ],
  };
}

/** 詳細から一覧用の項目だけを取り出す（一覧に詳細の項目を漏らさない）。 */
function toSummary(domain: DomainDetail): DomainSummary {
  return {
    name: domain.name,
    sld: domain.sld,
    tld: domain.tld,
    registry: domain.registry,
    statuses: domain.statuses,
    rgpStatuses: domain.rgpStatuses,
    ownership: domain.ownership,
    displayStatus: domain.displayStatus,
    registeredAt: domain.registeredAt,
    expiresAt: domain.expiresAt,
    rgpUntil: domain.rgpUntil,
    syncedAt: domain.syncedAt,
    stale: domain.stale,
    transfer: domain.transfer,
  };
}

function asStale(domain: DomainSummary): DomainSummary {
  return { ...domain, stale: true, syncedAt: at(-minutes(42)) };
}

/** ステータスを書き換えたら displayStatus も導出し直す。 */
function withDerivedStatus(domain: DomainDetail): DomainDetail {
  return {
    ...domain,
    displayStatus: deriveDisplayStatus({
      statuses: domain.statuses,
      rgpStatuses: domain.rgpStatuses,
      ownership: domain.ownership,
      transfer: domain.transfer,
    }),
  };
}

function requireDomain(store: MockStore, name: string): DomainDetail {
  const domain = store.domains.get(name);
  if (!domain) {
    fail("NOT_FOUND", `${name} は見つかりませんでした。`);
  }
  return domain;
}

/**
 * D-02 のロックトグル（`clientStatuses`）を EPP ステータス一覧に反映する（FR-09 / #205）。
 * レジストリと同じく解除 → 付与の順に適用し、重複は畳む。
 */
function applyClientStatuses(
  statuses: readonly string[],
  change: DomainUpdateInput["clientStatuses"],
): string[] {
  if (change === undefined) {
    return [...statuses];
  }
  const removed = new Set<string>(change.remove ?? []);
  return [
    ...new Set([
      ...statuses.filter((status) => !removed.has(status)),
      ...(change.add ?? []),
    ]),
  ];
}

function patchDomain(
  store: MockStore,
  name: string,
  patch: Partial<DomainDetail>,
): DomainDetail {
  const next = withDerivedStatus({
    ...requireDomain(store, name),
    ...patch,
    syncedAt: nowIso(),
  });
  store.domains.set(name, next);
  return next;
}

// ---- サブドメイン設計 ----

function applyStatusFor(
  host: SubdomainHost,
  zone: readonly DnsRecord[],
): SubdomainHost["applyStatus"] {
  const record = zone.find((r) => r.host === host.host);
  if (!record) {
    return "pending";
  }
  return record.recordType === host.recordType && record.target === host.target
    ? "applied"
    : "changed";
}

/** 保存されている設計に、DNS ゾーンと NS から導出した反映状態を載せて返す。 */
function hydratePlan(store: MockStore, plan: SubdomainPlan): SubdomainPlan {
  const zone = store.zones.get(plan.domain) ?? [];
  const domain = store.domains.get(plan.domain);
  return {
    ...plan,
    hosts: plan.hosts.map((host) => ({
      ...host,
      applyStatus: applyStatusFor(host, zone),
    })),
    nameserversSwitched:
      domain !== undefined && isDopaminNameservers(domain.nameservers),
  };
}

/** AI 提案の代わりに、リポジトリ名から決定的な 4 ホストを組み立てる。 */
function proposePlan(
  domain: string,
  input: { repoUrl?: string; description?: string },
): SubdomainPlan {
  const { sld } = splitDomainName(domain);
  const hosts: SubdomainHost[] = [
    {
      id: `${sld}-www`,
      host: "www",
      purpose: "ランディングページ",
      recordType: "A",
      target: "203.0.113.10",
      priority: "required",
      applyStatus: "pending",
    },
    {
      id: `${sld}-api`,
      host: "api",
      purpose: "API サーバー",
      recordType: "CNAME",
      target: `api.${sld}.example-app.com`,
      priority: "required",
      applyStatus: "pending",
    },
    {
      id: `${sld}-docs`,
      host: "docs",
      purpose: "ドキュメント",
      recordType: "CNAME",
      target: `docs.${sld}.example-app.com`,
      priority: "recommended",
      applyStatus: "pending",
    },
    {
      id: `${sld}-status`,
      host: "status",
      purpose: "ステータスページ",
      recordType: "A",
      target: "203.0.113.20",
      priority: "optional",
      applyStatus: "pending",
    },
  ];
  return {
    domain,
    repoUrl: input.repoUrl ?? null,
    policy:
      input.description ??
      "www と api を必須、docs と status は任意。TTL は 300 秒で統一する。",
    hosts,
    nameserversSwitched: false,
    savedAt: null,
    appliedAt: null,
  };
}

function computeDiff(store: MockStore, plan: SubdomainPlan): DnsDiff {
  const zone = store.zones.get(plan.domain) ?? [];
  const diff: DnsDiff = { added: [], updated: [], removed: [], unchanged: [] };
  for (const host of plan.hosts) {
    const previous = zone.find((r) => r.host === host.host);
    if (!previous) {
      diff.added.push({ ...host, applyStatus: "pending" });
    } else if (
      previous.recordType !== host.recordType ||
      previous.target !== host.target
    ) {
      diff.updated.push({
        host: { ...host, applyStatus: "changed" },
        previous,
      });
    } else {
      diff.unchanged.push(host.host);
    }
  }
  diff.removed = zone.filter(
    (record) => !plan.hosts.some((host) => host.host === record.host),
  );
  return diff;
}

// ---- 移管 ----

const TRANSFER_STATUS_BY_ACTION = {
  approve: "approved",
  reject: "rejected",
  cancel: "cancelled",
} as const;

function patchTransfer(
  store: MockStore,
  id: string,
  action: keyof typeof TRANSFER_STATUS_BY_ACTION,
): Transfer {
  const index = store.transfers.findIndex((t) => t.id === id);
  const current = store.transfers[index];
  if (!current) {
    fail("NOT_FOUND", "対象の移管が見つかりませんでした。");
  }
  const next: Transfer = {
    ...current,
    status: TRANSFER_STATUS_BY_ACTION[action],
    completedAt: nowIso(),
    actByAt: null,
  };
  store.transfers = store.transfers.map((t, i) => (i === index ? next : t));
  if (action === "approve" && current.direction === "out") {
    // 承認した OUT は所有権が移り、保有一覧から消える（AC-02-4 / S-34）
    patchDomain(store, current.domainName, {
      ownership: "transferred_out",
      statuses: ["ok"],
      transfer: null,
    });
    store.listedNames = store.listedNames.filter(
      (name) => name !== current.domainName,
    );
  }
  if (action === "reject" && current.direction === "out") {
    patchDomain(store, current.domainName, {
      statuses: ["ok"],
      transfer: null,
    });
  }
  return next;
}

export function createMockServices(
  scenario: MockScenario,
  opts?: { delayMs?: number },
): Services {
  const delayMs = opts?.delayMs ?? defaultDelayMs(scenario);
  const wait = () => delay(delayMs);
  const isEmpty = scenario === "empty";
  const isError = scenario === "error";
  const isStale = scenario === "stale";

  function listDomains(): DomainSummary[] {
    const store = getMockStore();
    const summaries = store.listedNames.flatMap((name) => {
      const domain = store.domains.get(name);
      return domain === undefined || domain.ownership !== "owned"
        ? []
        : [toSummary(domain)];
    });
    // 一覧は DB キャッシュを読むだけでレジストリに問い合わせないので stale は立てない。
    // 「同期に失敗した行だけ Stale」は sync() が作る（S-13）。
    return summaries;
  }

  function planFor(domain: string): SubdomainPlan {
    const store = getMockStore();
    const plan = store.plans.get(domain);
    if (!plan) {
      fail("NOT_FOUND", "保存済みの設計がありません。");
    }
    return plan;
  }

  return {
    auth: {
      isSupported: () => scenario !== "unsupported",
      async signup(displayName) {
        await wait();
        const store = getMockStore();
        store.me = {
          ...store.me,
          user: { ...store.me.user, displayName },
        };
        return store.me.user;
      },
      async login() {
        await wait();
        return getMockStore().me.user;
      },
      async logout() {
        await wait();
      },
      async addPasskey() {
        await wait();
        if (isError) {
          // S-70b: Banner Warn「パスキーを追加できませんでした」
          fail("INTERNAL", "パスキーを登録できませんでした。");
        }
        const store = getMockStore();
        store.sequence += 1;
        const passkey: PasskeySummary = {
          id: `pk_mock_${store.sequence}`,
          name: "追加したパスキー",
          deviceType: "multiDevice",
          backedUp: true,
          createdAt: nowIso(),
          lastUsedAt: null,
        };
        store.passkeys = [...store.passkeys, passkey];
        return passkey;
      },
      async listPasskeys() {
        await wait();
        return [...getMockStore().passkeys];
      },
      async deletePasskey(id) {
        await wait();
        const store = getMockStore();
        // UI は最後の 1 つを Disabled にするので、409 の見た目は conflict シナリオで再現する（D-09）
        if (scenario === "conflict" || store.passkeys.length <= 1) {
          fail("CONFLICT", "最後のパスキーは削除できません。");
        }
        store.passkeys = store.passkeys.filter((p) => p.id !== id);
      },
      async renamePasskey(id, name) {
        await wait();
        if (isError) {
          fail("INTERNAL", "パスキーの名前を変更できませんでした。");
        }
        // API と同じ制約（passkeyNameSchema）で弾き、trim 済みの値を保存する
        const parsed = passkeyNameSchema.safeParse(name);
        if (!parsed.success) {
          fail(
            "VALIDATION_ERROR",
            "パスキーの名前は 1〜32 文字で入力してください。",
          );
        }
        const store = getMockStore();
        const current = store.passkeys.find((p) => p.id === id);
        if (current === undefined) {
          fail("NOT_FOUND", "パスキーが見つかりません。");
        }
        const renamed: PasskeySummary = { ...current, name: parsed.data };
        store.passkeys = store.passkeys.map((p) => (p.id === id ? renamed : p));
        return renamed;
      },
    },

    domains: {
      /** GET /domains */
      async list() {
        await wait();
        if (isError) {
          registryUnavailable();
        }
        return isEmpty ? [] : listDomains();
      },

      /**
       * POST /domains/sync。
       *
       * `error` はリクエストごと落ちる（ハード失敗 → Error Card）。
       * `stale` は実 API と同じ「200 + 部分失敗」で返す: kitaqsign だけが応答せず、
       * その行だけ `stale: true`、kitaqnic の行は最新化できている（S-13 / AC-18-1）。
       */
      async sync(): Promise<SyncResult> {
        await wait();
        if (isError) {
          registryUnavailable();
        }
        const domains = isEmpty ? [] : listDomains();
        if (!isStale) {
          return { domains, failures: [] };
        }
        const down = new Set(
          domains
            .filter((domain) => domain.registry === "kitaqsign")
            .map((domain) => domain.name),
        );
        return {
          domains: domains.map((domain) =>
            down.has(domain.name) ? asStale(domain) : domain,
          ),
          failures: [...down].map((name) => ({
            name,
            code: "REGISTRY_UNAVAILABLE" as const,
            message: "Kitaqsign に接続できません。",
            registry: "kitaqsign" as const,
          })),
        };
      },

      /** GET /domains/:name */
      async get(name) {
        await wait();
        if (isError) {
          registryUnavailable();
        }
        const store = getMockStore();
        const domain = requireDomain(store, name);
        // API の詳細は `subdomain_plans` にある = 保存済みの設計だけを数える（#217）。
        // モックは提案（未保存）も plans に置くので、savedAt で同じ集合に絞る
        const plan = store.plans.get(name);
        const hydrated =
          plan && plan.savedAt !== null ? hydratePlan(store, plan) : null;
        const detail: DomainDetail = {
          ...domain,
          subdomainPlan: hydrated
            ? {
                hosts: hydrated.hosts.length,
                applied: hydrated.hosts.filter(
                  (h) => h.applyStatus === "applied",
                ).length,
              }
            : null,
        };
        return isStale
          ? { ...detail, stale: true, syncedAt: at(-minutes(42)) }
          : detail;
      },

      /** POST /domains/check */
      async check(input: DomainCheckRequest) {
        await wait();
        if (isError) {
          registryUnavailable();
        }
        const names =
          "names" in input
            ? input.names
            : input.tlds.map((tld) => `${input.sld}.${tld}`);
        const store = getMockStore();
        return names.map((name, index): SearchResult => {
          const { sld, tld } = splitDomainName(name);
          const registry = mockRegistryForName(name);
          // partial-failure は 2 件目以降の 1 つおきを「確認不可」にする（AC-03-2）
          const broken = scenario === "partial-failure" && index % 2 === 1;
          const taken = store.domains.has(name) || pseudoScore(name) % 3 === 0;
          return {
            name,
            sld,
            tld,
            registry,
            availability: broken
              ? "error"
              : taken
                ? "unavailable"
                : "available",
            uniqueness: uniquenessFor(name),
            alternatives: taken
              ? [`${sld}-app.${tld}`, `${sld}.xyz`, `get${sld}.${tld}`]
              : [],
            error: broken
              ? {
                  code: "REGISTRY_UNAVAILABLE",
                  message: "レジストリに接続できませんでした。",
                  retryable: true,
                  registry,
                }
              : null,
          };
        });
      },

      /** POST /domains */
      async register(input) {
        await wait();
        if (scenario === "conflict") {
          fail("CONFLICT", "このドメインは取得できません（既に登録済み）。");
        }
        if (isError) {
          // S-28: create タイムアウト。ローカルの情報は変更しない（FR-18）
          fail("REGISTRY_TIMEOUT", "レジストリが応答しませんでした。", {
            registry: mockRegistryForName(input.name),
          });
        }
        const store = getMockStore();
        const { sld, tld } = splitDomainName(input.name);
        const created = withDerivedStatus({
          name: input.name,
          sld,
          tld,
          registry: mockRegistryForName(input.name),
          statuses: ["inactive"],
          rgpStatuses: [],
          ownership: "owned",
          displayStatus: "inactive",
          registeredAt: nowIso(),
          expiresAt: at(days(365 * input.period)),
          rgpUntil: null,
          syncedAt: nowIso(),
          stale: false,
          transfer: null,
          nameservers: [],
          registrant: {
            name: "Taro Test",
            email: "taro.test@example.com",
            migrated: true,
          },
          gracePeriods: [{ kind: "add", until: at(days(5)) }],
          transferableFrom: at(days(60)),
          subdomainPlan: null,
        });
        store.domains.set(created.name, created);
        if (!store.listedNames.includes(created.name)) {
          store.listedNames = [created.name, ...store.listedNames];
        }
        return created;
      },

      /** POST /domains/:name/renew */
      async renew(name, input) {
        await wait();
        if (isError) {
          registryUnavailable();
        }
        const store = getMockStore();
        const current = requireDomain(store, name);
        const base = new Date(current.expiresAt ?? nowIso());
        base.setUTCFullYear(base.getUTCFullYear() + input.period);
        return patchDomain(store, name, { expiresAt: base.toISOString() });
      },

      /** PATCH /domains/:name */
      async update(name, input) {
        await wait();
        if (isError) {
          registryUnavailable();
        }
        const store = getMockStore();
        const current = requireDomain(store, name);
        const nameservers = input.nameservers ?? current.nameservers;
        const nsStatuses =
          nameservers.length === 0
            ? [...new Set([...current.statuses, "inactive"])]
            : current.statuses.filter((s) => s !== "inactive");
        const statuses = applyClientStatuses(nsStatuses, input.clientStatuses);
        // コンタクトを差し替えたら「移行済み」になる（S-39 の解消）
        const registrant =
          input.contacts === undefined
            ? current.registrant
            : { ...input.contacts.registrant, migrated: true };
        return patchDomain(store, name, { nameservers, statuses, registrant });
      },

      /** DELETE /domains/:name */
      async remove(name) {
        await wait();
        if (isError) {
          registryUnavailable();
        }
        const store = getMockStore();
        const current = requireDomain(store, name);
        // AGP（登録後 5 日）内は即時削除、それ以外は RGP 入り（AC-10-1）
        const withinAgp =
          new Date(current.registeredAt).getTime() >
          new Date(nowIso()).getTime() - days(5);
        if (withinAgp) {
          store.domains.delete(name);
          store.listedNames = store.listedNames.filter((n) => n !== name);
          return { outcome: "deleted" };
        }
        patchDomain(store, name, {
          rgpStatuses: ["redemptionPeriod"],
          rgpUntil: at(days(30)),
        });
        return { outcome: "rgp" };
      },

      /** POST /domains/:name/restore */
      async restore(name) {
        await wait();
        if (isError) {
          registryUnavailable();
        }
        const store = getMockStore();
        return patchDomain(store, name, { rgpStatuses: [], rgpUntil: null });
      },

      /** POST /domains/:name/auth-code（取得のたびに再発行される） */
      async authCode(name) {
        await wait();
        if (isError) {
          registryUnavailable();
        }
        const store = getMockStore();
        store.sequence += 1;
        return {
          authCode: `MOCK-${splitDomainName(name).sld.toUpperCase()}-${store.sequence}`,
        };
      },
    },

    candidates: {
      /** POST /ai/domain-candidates */
      async generate(input) {
        await wait();
        if (scenario === "ai-timeout") {
          failAi("REGISTRY_TIMEOUT", "AI が 20 秒以内に応答しませんでした。");
        }
        if (isError) {
          failAi("AI_UNAVAILABLE", "AI が利用できません。");
        }
        const store = getMockStore();
        const excluded = new Set(input.exclude ?? []);
        const tlds = input.tlds;
        const pool = store.candidatePool.filter((candidate) => {
          const name = `${candidate.sld}.${candidate.tld}`;
          if (excluded.has(name) || excluded.has(candidate.sld)) {
            return false;
          }
          return tlds === undefined || tlds.includes(candidate.tld);
        });
        const picked = pool.slice(0, 6);
        return picked.map((candidate, index): Candidate => {
          // partial-failure は一部を「確認不可」にする（AC-05-2）
          return scenario === "partial-failure" && index % 3 === 2
            ? { ...candidate, availability: "error" }
            : candidate;
        });
      },
    },

    subdomains: {
      /** GET /domains/:name/subdomain-plan（未作成は null = S-40） */
      async get(domain) {
        await wait();
        const store = getMockStore();
        const plan = store.plans.get(domain);
        return plan ? hydratePlan(store, plan) : null;
      },

      /** POST /domains/:name/subdomain-plan */
      async propose(domain, input) {
        await wait();
        if (scenario === "ai-timeout") {
          failAi("REGISTRY_TIMEOUT", "AI が 30 秒以内に応答しませんでした。");
        }
        if (isError) {
          // S-42: GitHub のリポジトリが見つからない / 非公開（AC-13-2）
          fail("NOT_FOUND", "リポジトリを取得できませんでした。");
        }
        const store = getMockStore();
        const plan = proposePlan(domain, input);
        store.plans.set(domain, plan);
        return hydratePlan(store, plan);
      },

      /** PUT /domains/:name/subdomain-plan */
      async save(domain, plan) {
        await wait();
        if (isError) {
          registryUnavailable();
        }
        const store = getMockStore();
        const saved: SubdomainPlan = {
          ...plan,
          domain,
          savedAt: nowIso(),
        };
        store.plans.set(domain, saved);
        return hydratePlan(store, saved);
      },

      /** GET /domains/:name/dns */
      async diff(domain) {
        await wait();
        if (isError) {
          registryUnavailable();
        }
        return computeDiff(getMockStore(), planFor(domain));
      },

      /** POST /domains/:name/subdomain-plan/apply */
      async apply(domain) {
        await wait();
        if (isError) {
          registryUnavailable();
        }
        const store = getMockStore();
        const plan = planFor(domain);
        const target = store.domains.get(domain);
        const alreadySwitched =
          target !== undefined && isDopaminNameservers(target.nameservers);

        if (scenario === "ns-fail") {
          // S-46: NS を切り替えられなかったのでレコードも変更しない（AC-13-5）
          return {
            plan: hydratePlan(store, plan),
            added: 0,
            updated: 0,
            removed: 0,
            nameserversChanged: false,
          };
        }

        const diff = computeDiff(store, plan);
        store.zones.set(
          domain,
          plan.hosts.map((host) => ({
            host: host.host,
            recordType: host.recordType,
            target: host.target,
            ttl:
              store.zones
                .get(domain)
                ?.find((record) => record.host === host.host)?.ttl ?? 300,
          })),
        );
        const applied: SubdomainPlan = { ...plan, appliedAt: nowIso() };
        store.plans.set(domain, applied);
        if (target && !alreadySwitched) {
          patchDomain(store, domain, {
            nameservers: [...DOPAMIN_NAMESERVERS],
            statuses: target.statuses.filter((s) => s !== "inactive"),
          });
        }
        return {
          plan: hydratePlan(store, applied),
          added: diff.added.length,
          updated: diff.updated.length,
          removed: diff.removed.length,
          nameserversChanged: !alreadySwitched,
        };
      },
    },

    transfers: {
      /** GET /transfers */
      async list() {
        await wait();
        if (isError) {
          registryUnavailable();
        }
        return isEmpty ? [] : [...getMockStore().transfers];
      },

      /** GET /transfers（Poll 消化 + transferQuery） */
      async refresh() {
        await wait();
        if (isError) {
          registryUnavailable();
        }
        return isEmpty ? [] : [...getMockStore().transfers];
      },

      /** POST /transfers */
      async request(input) {
        await wait();
        if (isError) {
          registryUnavailable();
        }
        if (input.authCode.trim().toLowerCase() === "bad") {
          // S-52: AuthCode 不一致（docs/requirements.md §10.3 の 2202）
          fail("REGISTRY_REJECTED", "AuthCode が正しくありません。", {
            registry: mockRegistryForName(input.name),
            registryCode: "2202",
          });
        }
        if (scenario === "conflict") {
          // S-52: すでに移管申請中（AC-12-2 の「pendingTransfer 中」/ 2300）
          fail("REGISTRY_REJECTED", "すでに移管申請中です。", {
            registry: mockRegistryForName(input.name),
            registryCode: "2300",
          });
        }
        const store = getMockStore();
        store.sequence += 1;
        const transfer: Transfer = {
          id: `trf_${store.sequence}`,
          domainName: input.name,
          registry: mockRegistryForName(input.name),
          direction: "in",
          status: "pending",
          requestedAt: nowIso(),
          actByAt: at(minutes(20)),
          completedAt: null,
        };
        store.transfers = [transfer, ...store.transfers];
        return transfer;
      },

      async approve(id) {
        await wait();
        if (isError) {
          registryUnavailable();
        }
        return patchTransfer(getMockStore(), id, "approve");
      },

      async reject(id) {
        await wait();
        if (isError) {
          registryUnavailable();
        }
        return patchTransfer(getMockStore(), id, "reject");
      },

      async cancel(id) {
        await wait();
        if (isError) {
          registryUnavailable();
        }
        return patchTransfer(getMockStore(), id, "cancel");
      },
    },

    logs: {
      /** GET /logs/operations */
      async operations() {
        await wait();
        if (isError) {
          fail("INTERNAL", "操作ログを取得できませんでした。");
        }
        return isEmpty ? [] : [...getMockStore().operationLogs];
      },

      /** GET /logs/ai */
      async ai() {
        await wait();
        if (isError) {
          fail("INTERNAL", "AI ログを取得できませんでした。");
        }
        return isEmpty ? [] : [...getMockStore().aiLogs];
      },
    },

    settings: {
      /**
       * GET /auth/me + AI 設定。
       * AppShell（サイドバーのユーザー名・テーマ）が常に描画できるよう、
       * どのシナリオでも成功させ、`loading` の 10 秒待ちにも巻き込まない。
       */
      async me() {
        await delay(Math.min(delayMs, 400));
        return getMockStore().me;
      },

      /** PATCH /settings/ai */
      async updateAi(input) {
        await wait();
        if (isError) {
          fail("INTERNAL", "AI 設定を保存できませんでした。");
        }
        const store = getMockStore();
        store.me = {
          ...store.me,
          ai: { ...store.me.ai, provider: input.provider, model: input.model },
        };
        return store.me.ai;
      },

      /** POST /demo/reset */
      async demoReset() {
        await wait();
        if (isError) {
          fail("INTERNAL", "デモデータをリセットできませんでした。");
        }
        resetMockStore();
      },
    },

    /** 決済モック（FR-19）。受付時刻は fixtures の「現在時刻」で決定的にする */
    payments: createMockPaymentService({ delayMs, now: nowIso }),
  };
}
