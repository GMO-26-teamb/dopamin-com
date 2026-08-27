import { type Db, schema } from "@dopamin/db";
import {
  DEFAULT_DNS_TTL,
  type DnsRecord,
  dnsRecordSchema,
  type SavedSubdomainProposal,
  savedSubdomainProposalSchema,
} from "@dopamin/shared";
import { asc, eq } from "drizzle-orm";
import { ApiException } from "../lib/errors";

/**
 * サブドメイン設計（`subdomain_plans`）と疑似 DNS ゾーン（`dns_records`）の永続化。
 * docs/requirements.md §9.1 / FR-13。
 *
 * どちらの jsonb / text 列も DB は素通しなので、読み戻すときは必ず zod で検証する（NFR-05）。
 */

/** 保存済みの設計 1 件（行 → サービスが扱う形）。 */
export interface SubdomainPlanRecord {
  id: string;
  domainId: string;
  repoUrl: string | null;
  proposal: SavedSubdomainProposal;
  savedAt: Date;
  appliedAt: Date | null;
}

/** 保存済みの設計が壊れている（語彙を狭めた変更などで読めない）ことを表す。 */
function corruptedPlan(): ApiException {
  return new ApiException(
    "INTERNAL",
    "保存されているサブドメイン設計を読み取れませんでした。設計を作り直してください。",
  );
}

/** 行 → レコード。`proposal` は jsonb なのでここで検証する。 */
function toPlanRecord(
  row: typeof schema.subdomainPlans.$inferSelect,
): SubdomainPlanRecord {
  const proposal = savedSubdomainProposalSchema.safeParse(row.proposal);
  if (!proposal.success) {
    throw corruptedPlan();
  }
  return {
    id: row.id,
    domainId: row.domainId,
    repoUrl: row.repoUrl,
    proposal: proposal.data,
    savedAt: row.updatedAt,
    appliedAt: row.appliedAt,
  };
}

/** ドメインの設計を 1 件引く（無ければ null）。 */
export async function findSubdomainPlan(
  db: Db,
  domainId: string,
): Promise<SubdomainPlanRecord | null> {
  const rows = await db
    .select()
    .from(schema.subdomainPlans)
    .where(eq(schema.subdomainPlans.domainId, domainId))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toPlanRecord(row);
}

/**
 * 設計を upsert する（1 ドメイン 1 件。`UNIQUE(domain_id)` が競合キー）。
 *
 * `applied_at` は触らない: 保存は DNS を変えないので、反映済みの日時は残したまま
 * 各ホストの反映状態だけが `changed` に倒れる（AC-13-6）。
 * `repo_summary` も同様に上書きしない（解析なしの保存で解析結果を消さない）。
 */
export async function upsertSubdomainPlan(
  db: Db,
  input: {
    domainId: string;
    repoUrl: string | null;
    proposal: SavedSubdomainProposal;
    savedAt?: Date;
  },
): Promise<SubdomainPlanRecord> {
  const updatedAt = input.savedAt ?? new Date();
  const rows = await db
    .insert(schema.subdomainPlans)
    .values({
      domainId: input.domainId,
      repoUrl: input.repoUrl,
      proposal: input.proposal,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: schema.subdomainPlans.domainId,
      set: {
        repoUrl: input.repoUrl,
        proposal: input.proposal,
        updatedAt,
      },
    })
    .returning();
  const row = rows[0];
  if (row === undefined) {
    throw new ApiException(
      "INTERNAL",
      "サブドメイン設計の保存に失敗しました。",
    );
  }
  return toPlanRecord(row);
}

/** 反映日時を更新する（apply の成功時。§9.1 `subdomain_plans.applied_at`）。 */
export async function markSubdomainPlanApplied(
  db: Db,
  planId: string,
  appliedAt: Date,
): Promise<void> {
  await db
    .update(schema.subdomainPlans)
    .set({ appliedAt })
    .where(eq(schema.subdomainPlans.id, planId));
}

/**
 * ドメインの疑似 DNS ゾーンを読む（ホスト → 種別の順）。
 * 値域（`record_type` / `source`）は text 列なので読み戻しでも検証する。
 */
export async function listDnsRecords(
  db: Db,
  domainId: string,
): Promise<DnsRecord[]> {
  const rows = await db
    .select()
    .from(schema.dnsRecords)
    .where(eq(schema.dnsRecords.domainId, domainId))
    .orderBy(asc(schema.dnsRecords.host), asc(schema.dnsRecords.recordType));
  return rows.map((row) => {
    const parsed = dnsRecordSchema.safeParse({
      host: row.host,
      recordType: row.recordType,
      target: row.target,
      ttl: row.ttl ?? DEFAULT_DNS_TTL,
      source: row.source,
      appliedAt: row.appliedAt.toISOString(),
    });
    if (!parsed.success) {
      throw new ApiException(
        "INTERNAL",
        "疑似 DNS ゾーンのレコードを読み取れませんでした。",
      );
    }
    return parsed.data;
  });
}
