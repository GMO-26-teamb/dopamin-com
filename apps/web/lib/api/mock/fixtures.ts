/**
 * モックの固定データ（fe-ui 設計 §4.4）。
 *
 * 日付はすべて基準時刻 {@link MOCK_NOW} からの相対で生成するので、
 * 「残 23 日」「復旧猶予 残 18 日」といった相対表示はいつ実行しても変わらない。
 *
 * 基準時刻の決め方（P9 統合 QA のルール）:
 * - テスト（`NODE_ENV === "test"`）… 固定値。テスト側は
 *   `vi.setSystemTime(new Date(MOCK_NOW))` で時計を合わせれば結果が決まる。
 * - dev / デモ … 読み込み時の実時刻（分単位に丸め）。固定値のままだと移管の
 *   カウントダウンがブラウザでは常に期限切れになり、「最終同期 たった今」も実時刻とずれる。
 *
 * `displayStatus` は `packages/shared` の `deriveDisplayStatus` から導出する（UI では再解釈しない）。
 * コンタクト情報はレジストリが許可するダミー値のみ（docs/registry/spec-notes.md）。
 */

import type { PasskeySummary } from "@dopamin/shared";
import {
  DOPAMIN_NAMESERVERS,
  deriveDisplayStatus,
  splitDomainName,
  uniquenessLabel,
} from "@dopamin/shared";
import { transferEligibleAt } from "../derive";
import type {
  AiLog,
  Candidate,
  DnsRecord,
  DomainDetail,
  GracePeriod,
  Me,
  OperationLog,
  Ownership,
  SubdomainPlan,
  Transfer,
  UniquenessScore,
} from "../types";

/** テストで使う固定基準時刻（2026-08-26T10:00:00+09:00）。 */
const FIXED_MOCK_NOW = new Date("2026-08-26T10:00:00+09:00");

/**
 * モックの基準時刻。テストだけ固定値、それ以外は読み込み時の実時刻（分単位に丸め）。
 * ファイル冒頭のコメントも参照。
 */
export const MOCK_NOW: Date =
  process.env.NODE_ENV === "test"
    ? FIXED_MOCK_NOW
    : new Date(Math.floor(Date.now() / 60_000) * 60_000);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 基準時刻からの相対時刻を ISO 8601 で返す。 */
export function at(offsetMs: number): string {
  return new Date(MOCK_NOW.getTime() + offsetMs).toISOString();
}

export const minutes = (n: number): number => n * MINUTE;
export const hours = (n: number): number => n * HOUR;
export const days = (n: number): number => n * DAY;

const OTHER_NAMESERVERS = ["ns1.example-dns.com", "ns2.example-dns.com"];

/**
 * モックの表示を実データに寄せるための TLD → レジストリ表（デモで使う TLD だけの部分集合）。
 * 正は `@dopamin/shared` の `REGISTRY_TLDS`（§11.2）。
 * ここはモックの見た目用で、実際のルーティングには使わない（表に無い TLD は "mock"）。
 */
const MOCK_REGISTRY_BY_TLD: Record<string, DomainDetail["registry"]> = {
  com: "kitaqsign",
  net: "kitaqsign",
  org: "kitaqsign",
  info: "kitaqsign",
  xyz: "kitaqnic",
  online: "kitaqnic",
  site: "kitaqnic",
  tech: "kitaqnic",
  space: "kitaqnic",
  store: "kitaqnic",
  fun: "kitaqnic",
};

/** FQDN からモック表示用のレジストリを引く。 */
export function mockRegistryForName(name: string): DomainDetail["registry"] {
  return MOCK_REGISTRY_BY_TLD[splitDomainName(name).tld] ?? "mock";
}

/** 既定の登録者（許可ダミー値）。 */
const REGISTRANT = { name: "Taro Test", email: "taro.test@example.com" };
/** 移管 IN 後にまだ差し替えていない旧レジストラのコンタクト（S-39）。 */
const LEGACY_REGISTRANT = { name: "John Doe", email: "john.doe@example.com" };

interface DomainSeed {
  name: string;
  registry: DomainDetail["registry"];
  statuses: string[];
  rgpStatuses?: string[];
  ownership?: Ownership;
  registeredAt: string;
  expiresAt: string | null;
  rgpUntil?: string | null;
  lastTransferAt?: string | null;
  transfer?: DomainDetail["transfer"];
  nameservers: string[];
  registrant?: DomainDetail["registrant"];
  gracePeriods?: GracePeriod[];
}

function buildDomain(seed: DomainSeed): DomainDetail {
  const { sld, tld } = splitDomainName(seed.name);
  const statuses = seed.statuses;
  const rgpStatuses = seed.rgpStatuses ?? [];
  const ownership = seed.ownership ?? "owned";
  const transfer = seed.transfer ?? null;
  return {
    name: seed.name,
    sld,
    tld,
    registry: seed.registry,
    statuses,
    rgpStatuses,
    ownership,
    displayStatus: deriveDisplayStatus({
      statuses,
      rgpStatuses,
      ownership,
      transfer,
    }),
    registeredAt: seed.registeredAt,
    expiresAt: seed.expiresAt,
    rgpUntil: seed.rgpUntil ?? null,
    syncedAt: at(-minutes(3)),
    stale: false,
    transfer,
    nameservers: seed.nameservers,
    registrant: seed.registrant ?? { ...REGISTRANT, migrated: true },
    gracePeriods: seed.gracePeriods ?? [],
    transferableFrom: transferEligibleAt(
      seed.registeredAt,
      seed.lastTransferAt ?? null,
    ),
    // 実際の設計は store の SubdomainPlan から都度導出する
    subdomainPlan: null,
  };
}

/** ダッシュボード（`GET /domains`）に出す 4 件。移管済みは出さない（AC-02-4）。 */
export const DASHBOARD_DOMAINS = [
  "takutaku.com",
  "harupika.xyz",
  "demo-app.online",
  "tkt-lab.net",
] as const;

/**
 * ドメイン一式。ダッシュボードの 4 件に加えて、詳細画面の状態（S-34 / S-36 / S-37 / S-38）を
 * 再現するための保有外・特殊状態のドメインを持つ（fe-ui 設計 §6 の URL 表）。
 */
export function createDomains(): DomainDetail[] {
  return [
    // S-30 Active
    buildDomain({
      name: "takutaku.com",
      registry: "kitaqsign",
      statuses: ["ok"],
      registeredAt: at(-days(400)),
      expiresAt: at(days(330)),
      nameservers: [...OTHER_NAMESERVERS],
    }),
    // Expiring（残 23 日）+ S-39 コンタクト未移行
    buildDomain({
      name: "harupika.xyz",
      registry: "kitaqnic",
      statuses: ["ok"],
      registeredAt: at(-days(342)),
      expiresAt: at(days(23)),
      lastTransferAt: at(-days(12)),
      nameservers: [...OTHER_NAMESERVERS],
      registrant: { ...LEGACY_REGISTRANT, migrated: false },
      gracePeriods: [{ kind: "transfer", until: at(days(3)) }],
    }),
    // S-33 復旧猶予（RGP）
    buildDomain({
      name: "demo-app.online",
      registry: "kitaqnic",
      statuses: ["ok"],
      rgpStatuses: ["redemptionPeriod"],
      registeredAt: at(-days(700)),
      expiresAt: at(-days(45)),
      rgpUntil: at(days(18)),
      nameservers: [],
      gracePeriods: [{ kind: "redemption", until: at(days(18)) }],
    }),
    // S-32 移管申請を受信（自動承認まで 15 分）
    buildDomain({
      name: "tkt-lab.net",
      registry: "kitaqsign",
      statuses: ["ok", "pendingTransfer"],
      registeredAt: at(-days(200)),
      expiresAt: at(days(165)),
      transfer: { direction: "out", actByAt: at(minutes(15)) },
      nameservers: [...DOPAMIN_NAMESERVERS],
    }),
    // S-34 移管済み（保有一覧には出さない）
    buildDomain({
      name: "old-blog.xyz",
      registry: "kitaqnic",
      statuses: ["ok"],
      ownership: "transferred_out",
      registeredAt: at(-days(900)),
      expiresAt: at(days(60)),
      lastTransferAt: at(-days(28)),
      nameservers: [...OTHER_NAMESERVERS],
    }),
    // S-37 停止中
    buildDomain({
      name: "hold.example",
      registry: "mock",
      statuses: ["ok", "clientHold"],
      registeredAt: at(-days(120)),
      expiresAt: at(days(245)),
      nameservers: [...DOPAMIN_NAMESERVERS],
    }),
    // S-38 NS 未設定
    buildDomain({
      name: "inactive.example",
      registry: "mock",
      statuses: ["inactive"],
      registeredAt: at(-days(4)),
      expiresAt: at(days(361)),
      nameservers: [],
      gracePeriods: [{ kind: "add", until: at(days(1)) }],
    }),
    // S-36 削除待ち
    buildDomain({
      name: "pending-delete.example",
      registry: "mock",
      statuses: ["pendingDelete"],
      rgpStatuses: ["pendingDelete"],
      registeredAt: at(-days(800)),
      expiresAt: at(-days(75)),
      nameservers: [],
      gracePeriods: [{ kind: "pendingDelete", until: at(days(4)) }],
    }),
    // Domain Card の Locked バリアント
    buildDomain({
      name: "locked.example",
      registry: "mock",
      statuses: ["ok", "clientTransferProhibited", "clientDeleteProhibited"],
      registeredAt: at(-days(260)),
      expiresAt: at(days(105)),
      nameservers: [...DOPAMIN_NAMESERVERS],
    }),
  ];
}

/**
 * 保存済みのサブドメイン設計（takutaku.com のみ = S-43）。
 * `applyStatus` / `nameserversSwitched` は DNS ゾーンとドメインの NS から都度導出するため、
 * ここでは仮の値（`pending` / false）を置く。
 */
export function createSubdomainPlans(): Record<string, SubdomainPlan> {
  return {
    "takutaku.com": {
      domain: "takutaku.com",
      repoUrl: "https://github.com/example/takutaku-app",
      policy:
        "www と api を必須、docs と status は任意。TTL は 300 秒で統一する。",
      hosts: [
        {
          id: "sh_001",
          host: "www",
          purpose: "ランディングページ",
          recordType: "A",
          target: "203.0.113.10",
          priority: "required",
          applyStatus: "pending",
        },
        {
          id: "sh_002",
          host: "api",
          purpose: "API サーバー",
          recordType: "CNAME",
          target: "api.example-app.com",
          priority: "required",
          applyStatus: "pending",
        },
        {
          id: "sh_003",
          host: "docs",
          purpose: "ドキュメント",
          recordType: "CNAME",
          target: "docs.example-app.com",
          priority: "recommended",
          applyStatus: "pending",
        },
        {
          id: "sh_004",
          host: "status",
          purpose: "ステータスページ",
          recordType: "A",
          target: "203.0.113.20",
          priority: "optional",
          applyStatus: "pending",
        },
      ],
      nameserversSwitched: false,
      savedAt: at(-days(2)),
      appliedAt: at(-days(2)),
    },
  };
}

/**
 * 疑似 DNS ゾーンの現在値。`docs` は設計と値が違い（= 変更あり）、`status` はまだ無い（= 未反映）。
 * S-43 のツリーに「反映済み / 変更あり / 未反映」が 1 画面で出る。
 */
export function createDnsZones(): Record<string, DnsRecord[]> {
  return {
    "takutaku.com": [
      { host: "www", recordType: "A", target: "203.0.113.10", ttl: 300 },
      {
        host: "api",
        recordType: "CNAME",
        target: "api.example-app.com",
        ttl: 300,
      },
      {
        host: "docs",
        recordType: "CNAME",
        target: "docs-old.example-app.com",
        ttl: 300,
      },
    ],
  };
}

/** `value` は独自性スコア（0〜100）、`nearest` の類似度は 0〜1（API と同じ単位）。 */
function score(value: number, nearest: [string, number][]): UniquenessScore {
  return {
    score: value,
    label: uniquenessLabel(value),
    nearest: nearest.map(([name, similarity]) => ({ name, similarity })),
  };
}

/**
 * 候補の母集団。`generate` は `exclude` を除いて先頭 6 件を返す（「もう一回考える」で入れ替わる）。
 */
export function createCandidatePool(): Candidate[] {
  return [
    {
      sld: "dopalab",
      tld: "com",
      reason: "短くて覚えやすく、実験的な雰囲気が出る",
      registry: "kitaqsign",
      availability: "available",
      uniqueness: score(86, [
        ["dopelab.com", 0.71],
        ["dopalabs.com", 0.68],
        ["dopa-lab.net", 0.55],
      ]),
      alternatives: [],
    },
    {
      sld: "tsukurun",
      tld: "xyz",
      reason: "「つくる」を動詞化した造語で被りにくい",
      registry: "kitaqnic",
      availability: "available",
      uniqueness: score(78, [
        ["tsukuru.xyz", 0.74],
        ["tsukurun.jp", 0.66],
        ["tukurun.xyz", 0.62],
      ]),
      alternatives: [],
    },
    {
      sld: "dopadeck",
      tld: "online",
      reason: "ダッシュボード感のある語尾で用途が伝わる",
      registry: "kitaqnic",
      availability: "available",
      uniqueness: score(61, [
        ["dopadeck.com", 0.82],
        ["dopedeck.online", 0.7],
        ["deckdopa.online", 0.51],
      ]),
      alternatives: [],
    },
    {
      sld: "yumemi-app",
      tld: "tech",
      reason: "ニックネームをそのまま活かした素直な案",
      registry: "kitaqnic",
      availability: "available",
      uniqueness: score(52, [
        ["yumemi.tech", 0.88],
        ["yumemiapp.tech", 0.84],
        ["yume-app.tech", 0.63],
      ]),
      alternatives: [],
    },
    {
      sld: "teamb-tools",
      tld: "site",
      reason: "チーム名と用途を並べた分かりやすい案",
      registry: "kitaqnic",
      availability: "available",
      uniqueness: score(41, [
        ["team-tools.site", 0.9],
        ["teambtools.site", 0.86],
        ["teamb.tools", 0.72],
      ]),
      alternatives: [],
    },
    {
      sld: "myapp2026",
      tld: "net",
      reason: "一般的な語の組み合わせで紛らわしい",
      registry: "kitaqsign",
      availability: "unavailable",
      uniqueness: score(24, [
        ["myapp2026.com", 0.96],
        ["myapp2025.net", 0.92],
        ["my-app2026.net", 0.89],
      ]),
      alternatives: ["myapp2026.xyz", "my-app2026.net", "myapp26.online"],
    },
    {
      sld: "hakobune",
      tld: "site",
      reason: "「箱舟」由来で語感がやわらかい",
      registry: "kitaqnic",
      availability: "available",
      uniqueness: score(74, [
        ["hakobune.com", 0.8],
        ["hakobune.tech", 0.76],
        ["hakobune-lab.site", 0.58],
      ]),
      alternatives: [],
    },
    {
      sld: "pikapika-dev",
      tld: "space",
      reason: "擬音でブランドの明るさを表現した案",
      registry: "kitaqnic",
      availability: "available",
      uniqueness: score(69, [
        ["pikapika.space", 0.79],
        ["pika-dev.space", 0.67],
        ["pikapikadev.com", 0.61],
      ]),
      alternatives: [],
    },
    {
      sld: "kitaq-studio",
      tld: "org",
      reason: "地名を入れて由来が伝わるようにした案",
      registry: "kitaqnic",
      availability: "available",
      uniqueness: score(58, [
        ["kitaq-studio.com", 0.91],
        ["kitaqstudio.org", 0.87],
        ["kitakyu-studio.org", 0.64],
      ]),
      alternatives: [],
    },
  ];
}

/** 移管一覧（受信 1 / 取り込み待ち 1 / 履歴 1）。 */
export function createTransfers(): Transfer[] {
  return [
    {
      id: "trf_001",
      domainName: "tkt-lab.net",
      registry: "kitaqsign",
      direction: "out",
      status: "pending",
      requestedAt: at(-minutes(5)),
      actByAt: at(minutes(15)),
      completedAt: null,
    },
    {
      id: "trf_002",
      domainName: "harupika.xyz",
      registry: "kitaqnic",
      direction: "in",
      status: "import_pending",
      requestedAt: at(-days(2)),
      actByAt: null,
      completedAt: at(-hours(1)),
    },
    {
      id: "trf_003",
      domainName: "old-blog.xyz",
      registry: "kitaqnic",
      direction: "out",
      status: "approved",
      requestedAt: at(-days(30)),
      actByAt: null,
      completedAt: at(-days(28)),
    },
  ];
}

/** 操作ログ 5 件（成功 / タイムアウト / レジストリ拒否を含む）。 */
export function createOperationLogs(): OperationLog[] {
  return [
    {
      id: "op_005",
      at: at(-minutes(3)),
      command: "domain:info",
      registry: "kitaqsign",
      domainName: "takutaku.com",
      status: "success",
      errorCode: null,
      registryCode: null,
      latencyMs: 318,
      request: { name: "takutaku.com" },
      response: { statuses: ["ok"], expiresAt: at(days(330)) },
    },
    {
      id: "op_004",
      at: at(-minutes(38)),
      command: "domain:transfer-request",
      registry: "kitaqsign",
      domainName: "tkt-lab.net",
      status: "error",
      errorCode: "REGISTRY_REJECTED",
      registryCode: "2202",
      latencyMs: 742,
      request: { name: "tkt-lab.net", authInfo: "***" },
      response: { code: 2202, msg: "Invalid authorization information" },
    },
    {
      id: "op_003",
      at: at(-hours(5)),
      command: "domain:renew",
      registry: "kitaqnic",
      domainName: "harupika.xyz",
      status: "timeout",
      errorCode: "REGISTRY_TIMEOUT",
      registryCode: null,
      latencyMs: 10_000,
      request: { name: "harupika.xyz", period: 1, curExpDate: at(days(23)) },
      response: null,
    },
    {
      id: "op_002",
      at: at(-days(2)),
      command: "domain:create",
      registry: "kitaqnic",
      domainName: "demo-app.online",
      status: "success",
      errorCode: null,
      registryCode: null,
      latencyMs: 1_452,
      request: { name: "demo-app.online", period: 1, authInfo: "***" },
      response: { crDate: at(-days(2)), exDate: at(days(363)) },
    },
    {
      id: "op_001",
      at: at(-days(2) - minutes(1)),
      command: "domain:check",
      registry: "kitaqsign",
      domainName: null,
      status: "success",
      errorCode: null,
      registryCode: null,
      latencyMs: 214,
      request: { names: ["dopalab.com", "myapp2026.net"] },
      response: { results: [{ available: true }, { available: false }] },
    },
  ];
}

/** AI ログ 4 件（成功 3 / タイムアウト 1）。 */
export function createAiLogs(): AiLog[] {
  return [
    {
      id: "ai_004",
      at: at(-minutes(12)),
      feature: "domain_candidates",
      provider: "google",
      model: "gemini-2.5-flash",
      inputSummary: "ニックネーム: たくたく / 用途: 個人開発のポートフォリオ",
      outputSummary: "候補 6 件（dopalab.com ほか）",
      status: "success",
      latencyMs: 4_231,
      tokens: 1_820,
      raw: { candidates: 6 },
    },
    {
      id: "ai_003",
      at: at(-minutes(12) + 1_000),
      feature: "uniqueness",
      provider: "google",
      model: "gemini-2.5-flash",
      inputSummary: "SLD 6 件のスコアリング",
      outputSummary: "平均 57 / 最高 86",
      status: "success",
      latencyMs: 1_604,
      tokens: 642,
      raw: { scores: [86, 78, 61, 52, 41, 24] },
    },
    {
      id: "ai_002",
      at: at(-days(2)),
      feature: "subdomain_plan",
      provider: "google",
      model: "gemini-2.5-flash",
      inputSummary: "リポジトリ: example/takutaku-app",
      outputSummary: "ホスト 4 件（www / api / docs / status）",
      status: "success",
      latencyMs: 6_120,
      tokens: 2_455,
      raw: { hosts: 4 },
    },
    {
      id: "ai_001",
      at: at(-days(3)),
      feature: "domain_candidates",
      provider: "google",
      model: "gemini-2.5-flash",
      inputSummary: "ニックネーム: はるぴか",
      outputSummary: "10 秒以内に応答なし",
      status: "error",
      latencyMs: 10_000,
      tokens: null,
      raw: { error: "deadline exceeded" },
    },
  ];
}

/** パスキー 2 件（1 件だけのときは削除不可 = D-09 の Disabled を確認できるよう 2 件）。 */
export function createPasskeys(): PasskeySummary[] {
  return [
    {
      id: "pk_01HZY0000000000000000001",
      name: "MacBook Pro",
      deviceType: "multiDevice",
      backedUp: true,
      createdAt: at(-days(30)),
      lastUsedAt: at(-hours(1)),
    },
    {
      id: "pk_01HZY0000000000000000002",
      name: "iPhone",
      deviceType: "singleDevice",
      backedUp: false,
      createdAt: at(-days(12)),
      lastUsedAt: at(-days(3)),
    },
  ];
}

/** ログイン中ユーザー。モックでは常にログイン済みとして扱う（fe-ui 設計 §1）。 */
export function createMe(): Me {
  return {
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      displayName: "デモユーザー",
    },
    features: { demoReset: true },
    ai: {
      provider: "google",
      model: "gemini-2.5-flash",
      providers: [
        { id: "google", models: ["gemini-2.5-flash", "gemini-2.5-pro"] },
        { id: "anthropic", models: ["claude-sonnet-4-5", "claude-haiku-4-5"] },
      ],
    },
  };
}
