/**
 * サブドメイン設計支援（FR-13）の zod スキーマと、疑似 DNS ゾーンとの差分計算。
 *
 * - 設計そのもの（`SubdomainItem` / 提案）は docs/requirements.md FR-13 と §9.1 `subdomain_plans.proposal`
 * - 反映先のレコードは §9.1 `dns_records`
 * - API 入出力は §10.1 の `/domains/:name/subdomain-plan`（POST / PUT / GET）・`/subdomain-plan/apply`・`/domains/:name/dns`
 *
 * ドパ民 DNS への NS 切替判定は `constants.ts` の `DOPAMIN_NAMESERVERS` /
 * {@link isDopaminNameservers} を再利用する（ここで定数を二重に持たない）。
 */

import { z } from "zod";
import { isDopaminNameservers } from "./constants";
import { domainNameSchema, hostNameSchema, isValidLabel } from "./domain-name";

// ---------------------------------------------------------------------------
// ホスト / レコードの基本要素
// ---------------------------------------------------------------------------

/** apex（ドメイン自身）を表すホスト表記。 */
export const SUBDOMAIN_APEX_HOST = "@";

/** ホスト名の比較キー（大文字小文字・前後空白の違いを無視する）。 */
function hostKey(host: string): string {
  return host.trim().toLowerCase();
}

/** 設計 / レコードのホスト。1 ラベル（例: `www` / `api`）または apex の `@`。 */
export const subdomainHostSchema = z
  .string()
  .min(1)
  .max(63)
  .transform((v) => v.trim().toLowerCase())
  .refine((v) => v === SUBDOMAIN_APEX_HOST || isValidLabel(v), {
    message:
      "ホストは 1 ラベル（英数字とハイフン）または apex の `@` で指定してください",
  });

/** 疑似 DNS ゾーンで扱うレコード種別（§9.1 dns_records.record_type）。 */
export const DNS_RECORD_TYPES = ["A", "CNAME", "ALIAS"] as const;
export const dnsRecordTypeSchema = z.enum(DNS_RECORD_TYPES);
export type DnsRecordType = z.infer<typeof dnsRecordTypeSchema>;

const IPV4_PATTERN =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/** IPv4 アドレス表記か判定する（A レコードの target 判定に使う）。 */
export function isIpv4(value: string): boolean {
  return IPV4_PATTERN.test(value);
}

/** target を比較・保存用に正規化する（小文字化 + 末尾ドット除去）。 */
function normalizeTarget(target: string): string {
  const lower = target.trim().toLowerCase();
  return lower.endsWith(".") ? lower.slice(0, -1) : lower;
}

/**
 * レコードの向き先。ホスト名（例: `cname.vercel-dns.com.`）または IPv4。
 * 末尾ドットは落として保持する。
 */
export const dnsTargetSchema = z
  .string()
  .min(1)
  .max(255)
  .transform(normalizeTarget)
  .refine((v) => isIpv4(v) || hostNameSchema.safeParse(v).success, {
    message: "target は IPv4 アドレスまたはホスト名で指定してください",
  });

/** TTL（秒）。既定 3600（§9.1）。 */
export const DEFAULT_DNS_TTL = 3600;
export const dnsTtlSchema = z
  .number()
  .int()
  .min(60)
  .max(604800)
  .default(DEFAULT_DNS_TTL);

/** レコードの出自。現状は設計からの反映のみ（将来の手動編集用に予約）。 */
export const DNS_RECORD_SOURCES = ["subdomain_plan"] as const;
export const dnsRecordSourceSchema = z
  .enum(DNS_RECORD_SOURCES)
  .default("subdomain_plan");

const isoDateTimeSchema = z.iso.datetime({ offset: true });

// ---------------------------------------------------------------------------
// 設計（SubdomainItem / 提案）
// ---------------------------------------------------------------------------

/** 各ホストの重要度（FR-13 の 必須 / 推奨 / 任意）。識別子は英語で持つ。 */
export const SUBDOMAIN_PRIORITIES = [
  "required",
  "recommended",
  "optional",
] as const;
export const subdomainPrioritySchema = z.enum(SUBDOMAIN_PRIORITIES);
export type SubdomainPriority = z.infer<typeof subdomainPrioritySchema>;

/**
 * 保存できる設計の件数（FR-13）。提案は 3 件以上を要求するが（{@link MIN_PROPOSED_ITEMS}）、
 * ユーザーは編集で 1 件まで減らせる。画面側の入力検証もこの値を使う（数値を二重に持たない）。
 */
export const MIN_SUBDOMAIN_ITEMS = 1;
export const MAX_SUBDOMAIN_ITEMS = 8;
/** AI の提案に要求する下限（FR-13「3〜8 件」）。 */
export const MIN_PROPOSED_ITEMS = 3;
/** 用途（1 ホストの説明）と全体方針の最大文字数。 */
export const MAX_SUBDOMAIN_PURPOSE_LENGTH = 100;
export const MAX_SUBDOMAIN_POLICY_LENGTH = 120;

/** 全体方針（`policy`）。提案・保存・応答で共通。 */
const policySchema = z.string().min(1).max(MAX_SUBDOMAIN_POLICY_LENGTH);

const subdomainItemShape = {
  host: subdomainHostSchema,
  /** そのホストの用途（例: ランディングページ）。 */
  purpose: z.string().min(1).max(MAX_SUBDOMAIN_PURPOSE_LENGTH),
  recordType: dnsRecordTypeSchema,
  target: dnsTargetSchema,
  priority: subdomainPrioritySchema,
};

/** A は IPv4、CNAME / ALIAS はホスト名という DNS 上の対応を検証する。 */
function checkRecordTypeAgainstTarget(
  value: { recordType: DnsRecordType; target: string },
  ctx: z.RefinementCtx,
): void {
  if (value.recordType === "A" && !isIpv4(value.target)) {
    ctx.addIssue({
      code: "custom",
      path: ["target"],
      message: "A レコードの target は IPv4 アドレスで指定してください",
    });
    return;
  }
  if (value.recordType !== "A" && isIpv4(value.target)) {
    ctx.addIssue({
      code: "custom",
      path: ["target"],
      message: `${value.recordType} レコードの target はホスト名で指定してください`,
    });
  }
}

/** 設計の 1 項目（§9.1 `subdomain_plans.proposal.items[]`）。 */
export const subdomainItemSchema = z
  .object(subdomainItemShape)
  .superRefine(checkRecordTypeAgainstTarget);
export type SubdomainItem = z.infer<typeof subdomainItemSchema>;

function hasUniqueHosts(items: readonly { host: string }[]): boolean {
  return new Set(items.map((item) => hostKey(item.host))).size === items.length;
}

const UNIQUE_HOSTS_MESSAGE = "同じホストを複数回指定することはできません";

/**
 * AI が返した提案の再検証（structured output は必ず再検証する）。
 * FR-13 の「3〜8 件」に加え、ホスト重複なしと `www` の存在を要求する。
 */
export const subdomainProposalSchema = z.object({
  /** 全体方針（120 字以内）。 */
  policy: policySchema,
  items: z
    .array(subdomainItemSchema)
    .min(MIN_PROPOSED_ITEMS)
    .max(MAX_SUBDOMAIN_ITEMS)
    .refine(hasUniqueHosts, { message: UNIQUE_HOSTS_MESSAGE })
    .refine((items) => items.some((item) => hostKey(item.host) === "www"), {
      message: "提案には www を含めてください",
    }),
});
export type SubdomainProposal = z.infer<typeof subdomainProposalSchema>;

/**
 * AI が返す設計 1 項目の「素の形」（structured output のスキーマに渡す形）。
 *
 * {@link subdomainItemSchema} をそのままモデルに渡すと、制約の大半
 * （`A` の target は IPv4・ホストは 1 ラベル）は `.refine` / `.superRefine` なので
 * JSON Schema には現れずモデルを拘束できないまま、1 件でも外れた瞬間に
 * `generateObject` が応答全体を捨ててしまう（8 件中 7 件が正しくても失う）。
 * ここでは形（5 つの文字列）だけを保証し、値の妥当性は 1 件ずつ
 * {@link pickValidSubdomainItems} で再検証する（`docs/specs/subdomain-plan.md` §2.5）。
 */
export const rawSubdomainItemSchema = z.object({
  host: z.string().max(253),
  purpose: z.string().max(500),
  recordType: z.string().max(32),
  target: z.string().max(255),
  priority: z.string().max(32),
});
export type RawSubdomainItem = z.infer<typeof rawSubdomainItemSchema>;

/**
 * AI の structured output。件数の上限は暴走時の歯止めで、FR-13 の「3〜8 件」は
 * プロンプトで指示し、実際の担保は {@link subdomainProposalSchema} での再検証で行う。
 */
export const subdomainProposalOutputSchema = z.object({
  policy: z.string().max(MAX_SUBDOMAIN_POLICY_LENGTH * 4),
  items: z
    .array(rawSubdomainItemSchema)
    .min(1)
    .max(MAX_SUBDOMAIN_ITEMS * 2),
});
export type SubdomainProposalOutput = z.infer<
  typeof subdomainProposalOutputSchema
>;

/** 検証に通らず落とした項目（構造化ログに出す。NFR-06）。 */
export interface DroppedSubdomainItem {
  /** AI が返した生のホスト表記（切り詰めるだけで正規化しない）。 */
  host: string;
  /** 落とした理由（zod の最初の issue）。 */
  reason: string;
}

/** {@link pickValidSubdomainItems} の結果。 */
export interface PickedSubdomainItems {
  items: SubdomainItem[];
  dropped: DroppedSubdomainItem[];
}

/** ログに載せるホスト表記の上限（生値をそのまま流さない）。 */
const DROPPED_HOST_MAX_LENGTH = 64;

/**
 * AI の素の出力を 1 項目ずつ検証し、通ったものだけを返す（FR-13 / AC-13-1）。
 *
 * 文字数（`purpose`）は表示上の制約なので**切り詰めて残す**（#66 の `reason` と同じ扱い）。
 * DNS として成立しない項目（ホストが 1 ラベルでない・`A` なのに target が IPv4 でない等）は
 * **その項目だけ落とす**。集合としての制約（`www` 必須 / 件数 / ホスト重複なし）は
 * ここでは見ない——呼び出し側が {@link subdomainProposalSchema} で掛ける。
 */
export function pickValidSubdomainItems(
  raw: readonly RawSubdomainItem[],
): PickedSubdomainItems {
  const items: SubdomainItem[] = [];
  const dropped: DroppedSubdomainItem[] = [];
  for (const item of raw) {
    const parsed = subdomainItemSchema.safeParse({
      ...item,
      purpose: item.purpose.trim().slice(0, MAX_SUBDOMAIN_PURPOSE_LENGTH),
    });
    if (parsed.success) {
      items.push(parsed.data);
      continue;
    }
    dropped.push({
      host: item.host.trim().slice(0, DROPPED_HOST_MAX_LENGTH),
      reason: parsed.error.issues[0]?.message ?? "検証に失敗しました",
    });
  }
  return { items, dropped };
}

/** 全体方針を上限文字数で切り詰める（`purpose` と同じく表示上の制約として扱う）。 */
export function clampSubdomainPolicy(policy: string): string {
  return policy.trim().slice(0, MAX_SUBDOMAIN_POLICY_LENGTH);
}

// ---------------------------------------------------------------------------
// API 入出力（§10.1）
// ---------------------------------------------------------------------------

/** 公開リポジトリの URL（`https://github.com/<owner>/<repo>`）。末尾の `/` と `.git` は落とす。 */
export const githubRepoUrlSchema = z
  .string()
  .min(1)
  .max(255)
  .transform((v) =>
    v
      .trim()
      .replace(/\/+$/, "")
      .replace(/\.git$/i, ""),
  )
  .refine((v) => /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(v), {
    message:
      "リポジトリ URL は https://github.com/<owner>/<repo> の形式で指定してください",
  });

/** `POST /domains/:name/subdomain-plan` の入力。リポ URL か概要テキストのどちらかが要る（AC-13-2）。 */
export const subdomainPlanGenerateRequestSchema = z
  .object({
    repoUrl: githubRepoUrlSchema.optional(),
    /** リポジトリを取得できない場合の代替入力（AC-13-2）。 */
    description: z.string().min(1).max(2000).optional(),
  })
  .refine((v) => v.repoUrl !== undefined || v.description !== undefined, {
    message:
      "リポジトリ URL またはプロジェクト概要のどちらかを指定してください",
  });
export type SubdomainPlanGenerateRequest = z.infer<
  typeof subdomainPlanGenerateRequestSchema
>;

/** `POST /domains/:name/subdomain-plan` の応答（保存前の提案）。 */
export const subdomainPlanProposalResponseSchema = z.object({
  domain: domainNameSchema,
  repoUrl: z.string().nullable(),
  policy: policySchema,
  items: z.array(subdomainItemSchema),
});
export type SubdomainPlanProposalResponse = z.infer<
  typeof subdomainPlanProposalResponseSchema
>;

/**
 * 保存済みの設計本体（§9.1 `subdomain_plans.proposal`）。
 *
 * 提案（{@link subdomainProposalSchema}）と違い `www` 必須と 3 件以上は課さない。
 * ユーザーは編集で `www` を外したり 1 件だけ残したりできるため。
 * DB から読み戻すときもこのスキーマで検証する（jsonb は素通しなので）。
 */
export const savedSubdomainProposalSchema = z.object({
  policy: policySchema,
  items: z
    .array(subdomainItemSchema)
    .min(MIN_SUBDOMAIN_ITEMS)
    .max(MAX_SUBDOMAIN_ITEMS)
    .refine(hasUniqueHosts, { message: UNIQUE_HOSTS_MESSAGE }),
});
export type SavedSubdomainProposal = z.infer<
  typeof savedSubdomainProposalSchema
>;

/** `PUT /domains/:name/subdomain-plan` の入力（ユーザーが編集した設計の保存）。 */
export const subdomainPlanSaveRequestSchema =
  savedSubdomainProposalSchema.extend({
    repoUrl: githubRepoUrlSchema.optional(),
  });
export type SubdomainPlanSaveRequest = z.infer<
  typeof subdomainPlanSaveRequestSchema
>;

/** ホストごとの反映状態（FR-13 の 未反映 / 反映済み / 変更あり）。 */
export const applyStateSchema = z.enum(["unapplied", "applied", "changed"]);
export type ApplyState = z.infer<typeof applyStateSchema>;

/** 保存済み設計の 1 項目（反映状態つき）。 */
export const subdomainPlanItemSchema = z
  .object({ ...subdomainItemShape, applyState: applyStateSchema })
  .superRefine(checkRecordTypeAgainstTarget);
export type SubdomainPlanItem = z.infer<typeof subdomainPlanItemSchema>;

/** `GET /domains/:name/subdomain-plan` の応答。 */
export const subdomainPlanResponseSchema = z.object({
  domain: domainNameSchema,
  repoUrl: z.string().nullable(),
  policy: z.string(),
  items: z.array(subdomainPlanItemSchema),
  /** 設計を保存した日時（§9.1 `subdomain_plans.updated_at`）。 */
  savedAt: isoDateTimeSchema,
  /** 最後に DNS へ反映した日時。未反映は null（§9.1 `subdomain_plans.applied_at`）。 */
  appliedAt: isoDateTimeSchema.nullable(),
  /**
   * 外部 DNS を使う場合のための設定手順テキスト（FR-13「手動設定」。コピー用）。
   * 内容は設計から一意に決まるので、生成は {@link buildDnsSetupInstructions} が SSOT。
   */
  instructions: z.string(),
});
export type SubdomainPlanResponse = z.infer<typeof subdomainPlanResponseSchema>;

/** `POST /domains/:name/subdomain-plan/apply` の入力。追加パラメータは持たない（将来の拡張点）。 */
export const subdomainPlanApplyRequestSchema = z.object({}).default({});
export type SubdomainPlanApplyRequest = z.infer<
  typeof subdomainPlanApplyRequestSchema
>;

/**
 * apply の応答（§10.1）。件数の名前は仕様どおり `updated`。
 * 差分計算側（{@link diffDnsRecords}）は反映状態の `changed`（変更あり）に名前を揃えているため、
 * `updated: diff.changed.length` で対応させる。
 */
export const subdomainPlanApplyResponseSchema = z.object({
  added: z.number().int().min(0),
  updated: z.number().int().min(0),
  removed: z.number().int().min(0),
  /** ドパ民 DNS へ NS を切り替えたか（FR-09 / AC-13-5）。 */
  nameserversChanged: z.boolean(),
});
export type SubdomainPlanApplyResponse = z.infer<
  typeof subdomainPlanApplyResponseSchema
>;

// ---------------------------------------------------------------------------
// 疑似 DNS ゾーン（§9.1 dns_records / §10.1 GET /domains/:name/dns）
// ---------------------------------------------------------------------------

/** 疑似 DNS ゾーンに保存されているレコード。 */
export const dnsRecordSchema = z.object({
  host: subdomainHostSchema,
  recordType: dnsRecordTypeSchema,
  target: dnsTargetSchema,
  ttl: dnsTtlSchema,
  source: dnsRecordSourceSchema,
  appliedAt: isoDateTimeSchema,
});
export type DnsRecord = z.infer<typeof dnsRecordSchema>;

/** 設計から導出した「あるべきレコード」。反映前なので `source` / `appliedAt` を持たない。 */
export const desiredDnsRecordSchema = z.object({
  host: subdomainHostSchema,
  recordType: dnsRecordTypeSchema,
  target: dnsTargetSchema,
  ttl: dnsTtlSchema,
});
export type DesiredDnsRecord = z.infer<typeof desiredDnsRecordSchema>;

/** 差分計算が必要とする最小のレコード形（DB 行・ビューモデルのどちらでも満たせる）。 */
export interface DnsRecordLike {
  host: string;
  recordType: DnsRecordType;
  target: string;
  ttl?: number;
}

/** 内容が変わるホスト。反映前後の両方を持つ（差分ダイアログ表示用）。 */
export interface DnsRecordChange<
  C extends DnsRecordLike = DnsRecord,
  D extends DnsRecordLike = DesiredDnsRecord,
> {
  current: C;
  desired: D;
}

/** 保存済み設計と疑似 DNS ゾーンの差分（AC-13-7 の確認ダイアログ / apply の件数）。 */
export interface DnsRecordDiff<
  C extends DnsRecordLike = DnsRecord,
  D extends DnsRecordLike = DesiredDnsRecord,
> {
  added: D[];
  changed: DnsRecordChange<C, D>[];
  removed: C[];
  unchanged: D[];
}

export const dnsRecordDiffSchema = z.object({
  added: z.array(desiredDnsRecordSchema),
  changed: z.array(
    z.object({ current: dnsRecordSchema, desired: desiredDnsRecordSchema }),
  ),
  removed: z.array(dnsRecordSchema),
  unchanged: z.array(desiredDnsRecordSchema),
});

/** `GET /domains/:name/dns` の応答（レコード一覧と保存済み設計との差分）。 */
export const dnsZoneResponseSchema = z.object({
  records: z.array(dnsRecordSchema),
  diff: dnsRecordDiffSchema,
});
export type DnsZoneResponse = z.infer<typeof dnsZoneResponseSchema>;

// ---------------------------------------------------------------------------
// 純粋関数（API の apply と Web の差分ダイアログ・バッジで共用する）
// ---------------------------------------------------------------------------

/** 設計の 1 項目から「あるべきレコード」を導出する。 */
export function subdomainItemToDnsRecord(
  item: Pick<SubdomainItem, "host" | "recordType" | "target">,
  ttl: number = DEFAULT_DNS_TTL,
): DesiredDnsRecord {
  return {
    host: hostKey(item.host),
    recordType: item.recordType,
    target: normalizeTarget(item.target),
    ttl,
  };
}

/**
 * 2 つのレコードが同じ内容かを判定する。target は末尾ドット・大文字小文字を無視し、
 * TTL は両方が値を持つときだけ比較する。
 */
export function isSameDnsRecord(a: DnsRecordLike, b: DnsRecordLike): boolean {
  if (a.recordType !== b.recordType) {
    return false;
  }
  if (normalizeTarget(a.target) !== normalizeTarget(b.target)) {
    return false;
  }
  return a.ttl === undefined || b.ttl === undefined || a.ttl === b.ttl;
}

/** 同じホストのレコード群から比較対象を選ぶ（同種があれば優先、なければ先頭）。 */
function pickMatch<C extends DnsRecordLike>(
  bucket: readonly C[],
  desired: DnsRecordLike,
): C | undefined {
  return bucket.find((r) => r.recordType === desired.recordType) ?? bucket[0];
}

/**
 * 現在の疑似 DNS ゾーン（`current`）とあるべきレコード（`desired`）の差分を求める。
 *
 * - ホスト単位で対応づける（設計はホスト重複なしが前提。§9.1 の UNIQUE(domain_id, host, record_type)
 *   により同一ホストに複数レコードが残っている場合、対応づかなかった分は `removed` に入る）
 * - 反映（upsert + 削除）を行うと `desired` と一致するため、続けて計算した差分は空になる
 */
export function diffDnsRecords<
  C extends DnsRecordLike,
  D extends DnsRecordLike,
>(current: readonly C[], desired: readonly D[]): DnsRecordDiff<C, D> {
  const currentByHost = new Map<string, C[]>();
  for (const record of current) {
    const key = hostKey(record.host);
    const bucket = currentByHost.get(key);
    if (bucket) {
      bucket.push(record);
    } else {
      currentByHost.set(key, [record]);
    }
  }

  const added: D[] = [];
  const changed: DnsRecordChange<C, D>[] = [];
  const unchanged: D[] = [];
  const matched = new Set<C>();

  for (const item of desired) {
    const bucket = currentByHost.get(hostKey(item.host)) ?? [];
    const match = pickMatch(bucket, item);
    if (match === undefined) {
      added.push(item);
      continue;
    }
    matched.add(match);
    if (isSameDnsRecord(match, item)) {
      unchanged.push(item);
    } else {
      changed.push({ current: match, desired: item });
    }
  }

  const removed = current.filter((record) => !matched.has(record));
  return { added, changed, removed, unchanged };
}

/** 設計の 1 項目の反映状態（FR-13 のバッジ / AC-13-6）を、現在のゾーンから導出する。 */
export function subdomainApplyState(
  item: Pick<SubdomainItem, "host" | "recordType" | "target">,
  records: readonly DnsRecordLike[],
  ttl: number = DEFAULT_DNS_TTL,
): ApplyState {
  const desired = subdomainItemToDnsRecord(item, ttl);
  const bucket = records.filter((r) => hostKey(r.host) === desired.host);
  const match = pickMatch(bucket, desired);
  if (match === undefined) {
    return "unapplied";
  }
  return isSameDnsRecord(match, desired) ? "applied" : "changed";
}

/**
 * 反映時に FR-09 の NS 切替が要るか（AC-13-5）。
 * ドパ民 DNS（`DOPAMIN_NAMESERVERS`）でなければ切替が必要。
 */
export function needsNameserverSwitch(nameservers: readonly string[]): boolean {
  return !isDopaminNameservers(nameservers);
}

/** 重要度の日本語表記（FR-13 の 必須 / 推奨 / 任意）。 */
const PRIORITY_LABELS: Record<SubdomainPriority, string> = {
  required: "必須",
  recommended: "推奨",
  optional: "任意",
};

/** ホスト表記を FQDN に直す（apex の `@` はドメイン自身）。 */
function toFqdn(host: string, domain: string): string {
  return hostKey(host) === SUBDOMAIN_APEX_HOST
    ? domain
    : `${hostKey(host)}.${domain}`;
}

/**
 * 外部 DNS に手で設定するための手順テキストを作る（FR-13「手動設定」）。
 *
 * 画面のコピーボタンと API の応答で同じ文言になるよう、生成はここに 1 本化する。
 * 反映状態（`applyState`）には触れない: 手順は「どう設定するか」であって、
 * ドパ民の疑似 DNS ゾーンに反映済みかどうかとは別の話だから。
 */
export function buildDnsSetupInstructions(
  domain: string,
  items: readonly Pick<
    SubdomainItem,
    "host" | "purpose" | "recordType" | "target" | "priority"
  >[],
  ttl: number = DEFAULT_DNS_TTL,
): string {
  const header = [
    `${domain} のサブドメイン設定手順`,
    "",
    "お使いの DNS サービスの管理画面で、次のレコードを追加してください。",
    `TTL は ${ttl} 秒を想定しています。`,
    "",
  ];
  const body = items.map((item, index) => {
    const label = PRIORITY_LABELS[item.priority];
    return [
      `${index + 1}. ${toFqdn(item.host, domain)}（${label}）— ${item.purpose}`,
      `   ホスト: ${hostKey(item.host)} / 種別: ${item.recordType} / 値: ${normalizeTarget(item.target)} / TTL: ${ttl}`,
    ].join("\n");
  });
  return [...header, ...body].join("\n");
}
