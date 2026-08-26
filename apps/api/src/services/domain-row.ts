import type { schema } from "@dopamin/db";
import {
  type DomainInfo,
  type Ownership,
  registryIdSchema,
  splitDomainName,
} from "@dopamin/shared";
import { z } from "zod";

/**
 * `domains` テーブルの 1 行（docs/requirements.md §9.1）。
 *
 * レジストリが正（§6.5）なので、この行は「ユーザーとの紐付け + 表示用キャッシュ + 同期時刻」。
 * 表示に必要な値は最後の `info` の正規化結果（{@link DomainRecord.info}）から取り出す。
 */
export interface DomainRecord {
  userId: string;
  name: string;
  registry: DomainInfo["registry"];
  /**
   * 所有権。移管 OUT 完了の検知（#56）と `ownership` 列（#33）が入るまでは常に `owned`。
   * `domains` に行があること自体が保有中を意味する。
   */
  ownership: Ownership;
  /** 最後に取得した `info` の正規化結果。 */
  info: DomainInfo;
  /** 最後にレジストリと同期できた時刻。 */
  syncedAt: Date;
}

export type DomainRow = typeof schema.domains.$inferSelect;
export type DomainValues = typeof schema.domains.$inferInsert;

/**
 * `raw_info` に保存する正規化済み `DomainInfo`。
 * 読み出し時に検証し、壊れていれば型付き列から最小限を再構成する（NFR-05）。
 */
export const storedInfoSchema = z.object({
  name: z.string(),
  registry: registryIdSchema,
  statuses: z.array(z.string()),
  registrant: z.string(),
  contacts: z.record(z.string(), z.string()),
  nameservers: z.array(z.string()),
  registeredAt: z.string(),
  updatedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  lastTransferAt: z.string().nullable(),
  // 既存行の raw_info にはこのキーが無い（#26 以前に書かれた行）。必須にすると全行が
  // parse に失敗して fallbackInfo に落ち、registrant / contacts が静かに消えるため既定 null。
  sponsoringRegistrarId: z.string().nullable().default(null),
  rgpStatuses: z.array(z.string()),
});

/**
 * 型付き列から最小限の DomainInfo を組み立てる（raw_info が無い / 壊れている行の保険）。
 * 一覧が空になるより、欠けた値を諦めてでも行を表示する方が復旧しやすい。
 */
export function fallbackInfo(row: DomainRow): DomainInfo {
  return {
    name: row.name,
    registry: registryIdSchema.catch("mock").parse(row.registry),
    statuses: row.statuses,
    registrant: "",
    contacts: {},
    nameservers: row.nameservers,
    registeredAt: (row.registeredAt ?? row.createdAt).toISOString(),
    updatedAt: null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastTransferAt: row.lastTransferAt?.toISOString() ?? null,
    // domains に sponsoring_registrar_id 列がまだ無い（列追加は #33）。
    sponsoringRegistrarId: null,
    rgpStatuses: row.rgpStatus ? [row.rgpStatus] : [],
  };
}

/** DB の行 → アプリ内表現。 */
export function toDomainRecord(row: DomainRow): DomainRecord {
  const parsed = storedInfoSchema.safeParse(row.rawInfo);
  const info = parsed.success ? parsed.data : fallbackInfo(row);
  return {
    userId: row.userId,
    name: row.name,
    registry: info.registry,
    ownership: "owned",
    info,
    syncedAt: row.syncedAt ?? row.createdAt,
  };
}

/** アプリ内表現 → DB の行（insert / update の値）。 */
export function toDomainValues(record: DomainRecord): DomainValues {
  const { sld, tld } = splitDomainName(record.name);
  const { info } = record;
  // RGP の主ステータス（§9.1 rgp_status）。復旧可否の判定は rgpStatuses 全体で行うため、
  // ここは一覧のバッジ用に代表値を 1 つ選ぶだけ（redemptionPeriod を最優先）。
  const rgpStatus =
    info.rgpStatuses.find((s) => s === "redemptionPeriod") ??
    info.rgpStatuses[0] ??
    null;
  return {
    userId: record.userId,
    name: record.name,
    sld,
    tld,
    registry: record.registry,
    statuses: info.statuses,
    nameservers: info.nameservers,
    registeredAt: new Date(info.registeredAt),
    expiresAt: info.expiresAt ? new Date(info.expiresAt) : null,
    lastTransferAt: info.lastTransferAt ? new Date(info.lastTransferAt) : null,
    rgpStatus,
    rawInfo: info,
    syncedAt: record.syncedAt,
  };
}
