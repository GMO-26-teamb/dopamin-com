import { type Db, schema } from "@dopamin/db";
import { type RegistryAdapter, RegistryError } from "@dopamin/registry";
import type {
  AuthUser,
  DesiredDnsRecord,
  DnsRecord,
  DnsRecordDiff,
  DnsZoneResponse,
  OperationLogStatus,
  SubdomainPlanApplyResponse,
} from "@dopamin/shared";
import {
  DEFAULT_DNS_TTL,
  DOPAMIN_NAMESERVERS,
  diffDnsRecords,
  isOperationAllowed,
  needsNameserverSwitch,
  operationLogStatusFromErrorCode,
  subdomainItemToDnsRecord,
} from "@dopamin/shared";
import { and, eq } from "drizzle-orm";
import { ApiException } from "../lib/errors";
import { getRequestContext } from "../lib/operation-log-context";
import { reconcileOnTimeout } from "../lib/reconcile";
import { refreshDomainFromInfo } from "./domain.service";
import type { DomainRecord } from "./domain-store";
import { recordAppOperation } from "./operation-log.service";
import {
  findSubdomainPlan,
  listDnsRecords,
  markSubdomainPlanApplied,
  type SubdomainPlanRecord,
} from "./subdomain-plan-store";

/**
 * 疑似 DNS ゾーン（docs/requirements.md FR-13 / §10.1
 * `POST /domains/:name/subdomain-plan/apply`・`GET /domains/:name/dns`）。
 *
 * 差分の計算は `packages/shared` の `diffDnsRecords`（純粋関数）が SSOT で、
 * apply の実行と `GET /dns` の dry-run はどちらも同じ計算を使う（AC-13-7 の確認ダイアログと
 * 実際に起きることがずれないようにするため）。
 */

/** 保存済み設計から「あるべきレコード」を導く。 */
function desiredRecords(plan: SubdomainPlanRecord): DesiredDnsRecord[] {
  return plan.proposal.items.map((item) => subdomainItemToDnsRecord(item));
}

/**
 * 失敗の統一エラーコード（§10.3）。NS 切替の失敗はレジストリ由来なので、
 * `RegistryError` のコードをそのまま残して障害調査に使えるようにする。
 */
function errorCodeOf(error: unknown): string {
  if (error instanceof RegistryError) {
    return error.code;
  }
  return error instanceof ApiException ? error.code : "INTERNAL";
}

/** 差分が空（= 反映するものが無い）か。 */
function isEmptyDiff(
  diff: DnsRecordDiff<DnsRecord, DesiredDnsRecord>,
): boolean {
  return (
    diff.added.length === 0 &&
    diff.changed.length === 0 &&
    diff.removed.length === 0
  );
}

/**
 * FR-13: 疑似 DNS ゾーンの一覧と、保存済み設計との差分。
 *
 * 設計が保存されていない場合は「あるべきレコード」が決まらないので、差分は空で返す
 * （desired を空集合として扱うと、既存レコードが全部 `removed` に見えてしまう）。
 */
export async function getDnsZone(
  db: Db,
  domainId: string,
): Promise<DnsZoneResponse> {
  const [records, plan] = await Promise.all([
    listDnsRecords(db, domainId),
    findSubdomainPlan(db, domainId),
  ]);
  const diff =
    plan === null
      ? { added: [], changed: [], removed: [], unchanged: [] }
      : diffDnsRecords(records, desiredRecords(plan));
  return { records, diff };
}

/**
 * AC-13-5: NS がドパ民 DNS でなければ FR-09 の経路で切り替える。
 * 切替が要らなければ false を返し、失敗は例外のまま呼び出し側へ投げる
 * （レコードを 1 件も変更しないため）。
 */
async function switchNameserversIfNeeded(
  userId: string,
  adapter: RegistryAdapter,
  name: string,
  owned: DomainRecord,
): Promise<boolean> {
  const current = await adapter.info(name);
  if (!needsNameserverSwitch(current.nameservers)) {
    return false;
  }

  const opCheck = isOperationAllowed("update", current.statuses, {
    ownership: owned.ownership,
    rgpStatuses: current.rgpStatuses,
  });
  if (!opCheck.allowed) {
    throw new ApiException(
      "OPERATION_NOT_ALLOWED",
      "現在のステータスではネームサーバを変更できないため、DNS に反映できません。",
      { statuses: opCheck.blockedBy },
    );
  }

  // FR-09 と同じく「変更後の全量」から add / remove の差分を作る。
  // ホストオブジェクトの自動作成（ensureHosts）はアダプタの update 内部で行われる
  const desired = new Set<string>(DOPAMIN_NAMESERVERS);
  const currentNs = new Set(current.nameservers.map((ns) => ns.toLowerCase()));
  const add = [...desired].filter((ns) => !currentNs.has(ns));
  const remove = [...currentNs].filter((ns) => !desired.has(ns));

  // AC-18-2: タイムアウト時は info で NS が入れ替わったかを照合する
  const after = await reconcileOnTimeout(
    () =>
      adapter.update(name, {
        ...(add.length > 0 ? { addNameservers: add } : {}),
        ...(remove.length > 0 ? { removeNameservers: remove } : {}),
      }),
    async () => {
      const info = await adapter.info(name);
      return needsNameserverSwitch(info.nameservers) ? null : info;
    },
  );
  // 一覧・詳細に切替後の NS を反映する（§6.5 の write-through）
  await refreshDomainFromInfo(userId, after);
  return true;
}

/** 差分どおりに `dns_records` を upsert / 削除する（1 トランザクション）。 */
async function writeRecords(
  db: Db,
  domainId: string,
  diff: DnsRecordDiff<DnsRecord, DesiredDnsRecord>,
  appliedAt: Date,
): Promise<void> {
  const upserts = [
    ...diff.added,
    ...diff.changed.map((change) => change.desired),
  ];
  // 種別が変わった変更（CNAME → A など）は、upsert の競合キーに record_type が
  // 含まれるため新種別の行が INSERT されるだけで旧種別の行に触れない。旧行を
  // 残すと反映直後の GET /dns の差分が空にならず AC-13-4 を満たさないので、
  // current 側も削除対象に含める
  const removals = [
    ...diff.removed,
    ...diff.changed
      .filter(
        (change) => change.current.recordType !== change.desired.recordType,
      )
      .map((change) => change.current),
  ];
  await db.transaction(async (tx) => {
    for (const record of upserts) {
      await tx
        .insert(schema.dnsRecords)
        .values({
          domainId,
          host: record.host,
          recordType: record.recordType,
          target: record.target,
          ttl: record.ttl ?? DEFAULT_DNS_TTL,
          source: "subdomain_plan",
          appliedAt,
        })
        // UNIQUE(domain_id, host, record_type) が競合キー（§9.1）
        .onConflictDoUpdate({
          target: [
            schema.dnsRecords.domainId,
            schema.dnsRecords.host,
            schema.dnsRecords.recordType,
          ],
          set: {
            target: record.target,
            ttl: record.ttl ?? DEFAULT_DNS_TTL,
            source: "subdomain_plan",
            appliedAt,
          },
        });
    }
    // 設計から消えたホストと、種別が変わって置き換えられた旧行を落とす
    for (const record of removals) {
      await tx
        .delete(schema.dnsRecords)
        .where(
          and(
            eq(schema.dnsRecords.domainId, domainId),
            eq(schema.dnsRecords.host, record.host),
            eq(schema.dnsRecords.recordType, record.recordType),
          ),
        );
    }
  });
}

export interface ApplySubdomainPlanInput {
  db: Db;
  user: AuthUser;
  adapter: RegistryAdapter;
  domain: string;
  owned: DomainRecord;
  domainId: string;
}

/**
 * FR-13 / AC-13-4・AC-13-5・AC-13-7: 保存済み設計を疑似 DNS ゾーンに反映する。
 *
 * 順序が重要で、NS 切替を**先**に行う。切替に失敗した場合はレコードを 1 件も変更せず
 * FR-18 のエラーをそのまま返す（AC-13-5）。切替が成功してからレコードを
 * upsert / 削除し、`subdomain_plans.applied_at` を更新する。
 *
 * 反映は AI 呼び出しを伴わないので `ai_logs` には残らず、操作ログ（FR-15）に
 * `subdomain_plan.apply` として 1 行残る。NS 切替のレジストリ呼び出しは
 * 従来どおり `update` として別行で記録される。
 */
export async function applySubdomainPlan(
  input: ApplySubdomainPlanInput,
): Promise<SubdomainPlanApplyResponse> {
  const { db, domain, domainId } = input;
  const plan = await findSubdomainPlan(db, domainId);
  if (plan === null) {
    throw new ApiException(
      "NOT_FOUND",
      "反映するサブドメイン設計が保存されていません。",
    );
  }

  const current = await listDnsRecords(db, domainId);
  const diff = diffDnsRecords(current, desiredRecords(plan));

  const startedAt = Date.now();
  let nameserversChanged = false;
  try {
    // AC-13-5: 先に NS を切り替える。ここで失敗したらレコードは変更しない
    nameserversChanged = await switchNameserversIfNeeded(
      input.user.id,
      input.adapter,
      domain,
      input.owned,
    );

    const appliedAt = new Date();
    if (!isEmptyDiff(diff)) {
      await writeRecords(db, domainId, diff, appliedAt);
    }
    // 差分が空でも「この時点の設計は反映済み」なので日時は進める（AC-13-4）
    await markSubdomainPlanApplied(db, plan.id, appliedAt);
  } catch (error) {
    const errorCode = errorCodeOf(error);
    await recordApply(db, input, diff, {
      // AC-15-1: タイムアウトと仕様不一致は個別種別で残す（operationLogStatusFromErrorCode）
      status: operationLogStatusFromErrorCode(errorCode),
      errorCode,
      nameserversChanged,
      latencyMs: Date.now() - startedAt,
    });
    throw error;
  }

  await recordApply(db, input, diff, {
    status: "success",
    errorCode: null,
    nameserversChanged,
    latencyMs: Date.now() - startedAt,
  });

  return {
    added: diff.added.length,
    // 応答の名前は §10.1 の仕様どおり `updated`（差分計算側の `changed` に対応）
    updated: diff.changed.length,
    removed: diff.removed.length,
    nameserversChanged,
  };
}

/** 反映 1 回を操作ログ（FR-15）に残す。記録の失敗は反映の成否に影響させない。 */
async function recordApply(
  db: Db,
  input: ApplySubdomainPlanInput,
  diff: DnsRecordDiff<DnsRecord, DesiredDnsRecord>,
  result: {
    status: OperationLogStatus;
    errorCode: string | null;
    nameserversChanged: boolean;
    latencyMs: number;
  },
): Promise<void> {
  await recordAppOperation(db, {
    userId: input.user.id,
    requestId: getRequestContext().requestId,
    registry: input.adapter.id,
    command: "subdomain_plan.apply",
    domainName: input.domain,
    status: result.status,
    errorCode: result.errorCode,
    request: {
      added: diff.added.map((r) => r.host),
      updated: diff.changed.map((change) => change.desired.host),
      removed: diff.removed.map((r) => r.host),
    },
    response: {
      added: diff.added.length,
      updated: diff.changed.length,
      removed: diff.removed.length,
      nameserversChanged: result.nameserversChanged,
    },
    latencyMs: result.latencyMs,
  });
}
