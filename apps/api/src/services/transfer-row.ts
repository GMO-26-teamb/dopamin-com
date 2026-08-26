import type { schema } from "@dopamin/db";
import {
  registryIdSchema,
  type TransferSummary,
  transferDirectionSchema,
  transferRecordStatusSchema,
} from "@dopamin/shared";
import { z } from "zod";

/**
 * `transfers` テーブル（docs/requirements.md §9.1）の行 ↔ API 表現の写像（純粋関数）。
 * domain-row.ts と同じ役割で、DB 依存のクエリは transfer.service.ts に置く。
 */

export type TransferRow = typeof schema.transfers.$inferSelect;
export type TransferValues = typeof schema.transfers.$inferInsert;

/**
 * `transfers.raw` に保存する JSON の形。
 *
 * レジストリの生応答は `registry` キーの下に隔離し、アプリが付ける照合メタと混ぜない
 * （生応答は `EppEnvelope` の looseObject でパースされるため、レジストリが authInfo を
 * echo すればそのまま入りうる。だからこの列は API 応答には絶対に載せない。FR-18 / AC-15-2）。
 */
export interface StoredTransferRaw {
  /** 最後の `transferRequest` / `transferQuery` のレジストリ生応答。 */
  registry?: unknown;
  /** 最後に照合した時刻（ISO 8601）。 */
  checkedAt?: string;
  /**
   * `transferRequest` がタイムアウトし、`transferQuery` でも受理を確認できなかった印。
   * 行だけ作っておき、次回の照合で「実は完了していた」を拾えるようにする（ADR-0002 の宿題）。
   */
  reconcile?: "timeout_unconfirmed";
}

/**
 * 表示・導出に使う値だけを検証する。想定外の値で一覧全体が 500 にならないよう、
 * enum 系は `.catch()` で既定値に倒す（NFR-05。domain-row.ts と同じ流儀）。
 */
const rowStatusSchema = transferRecordStatusSchema.catch("pending");
const rowDirectionSchema = transferDirectionSchema.catch("in");
const rowRegistrySchema = registryIdSchema.catch("mock");

/** `transfers.raw` を読み直す（想定外の形なら空として扱う。NFR-05）。 */
const storedRawSchema = z.object({
  registry: z.unknown().optional(),
  checkedAt: z.string().optional(),
  reconcile: z.literal("timeout_unconfirmed").optional(),
});

export function readStoredRaw(raw: unknown): StoredTransferRaw {
  const parsed = storedRawSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

/**
 * 既存の `raw` に照合結果を重ねる。
 * `undefined` を渡したキーは JSON 化の時点で落ちる（`reconcile` の印を外す用途）。
 */
export function nextStoredRaw(
  previous: unknown,
  patch: StoredTransferRaw,
): StoredTransferRaw {
  return { ...readStoredRaw(previous), ...patch };
}

/**
 * DB の行 → API の要約（§10.1 `GET /transfers`）。
 *
 * `raw` と `registry_message_id` は落とす（FR-18 / NFR-03）。
 * `requested_at` は §9.1 では nullable だが、本アプリが作る行では必ず埋める。
 * Poll 由来の行（#58）が欠いていた場合に一覧が壊れないよう `created_at` に落とす。
 */
export function toTransferSummary(row: TransferRow): TransferSummary {
  return {
    id: row.id,
    domainName: row.domainName,
    registry: rowRegistrySchema.parse(row.registry),
    direction: rowDirectionSchema.parse(row.direction),
    status: rowStatusSchema.parse(row.status),
    registryStatus: row.registryStatus,
    counterpartRegistrarId: row.counterpartRegistrarId,
    requestedAt: (row.requestedAt ?? row.createdAt).toISOString(),
    actByAt: row.actByAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    domainId: row.domainId,
  };
}
