import { type Db, schema } from "@dopamin/db";
import {
  type RegistryId,
  registryIdSchema,
  type TransferDirection,
  type TransferRecordStatus,
  transferDirectionSchema,
  transferRecordStatusSchema,
} from "@dopamin/shared";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../lib/db";

/**
 * `transfers` テーブルの 1 行（docs/requirements.md §9.1）。
 *
 * ドメインの識別は常に `domainName`（FQDN）が正で、`domainId` は「紐付けられたら埋める」
 * 任意の参照。移管 IN は承認を検知して取り込むまで `domains` 行が無いため null になる。
 */
export interface TransferRecord {
  id: string;
  userId: string;
  domainId: string | null;
  domainName: string;
  registry: RegistryId;
  direction: TransferDirection;
  status: TransferRecordStatus;
  registryStatus: string | null;
  counterpartRegistrarId: string | null;
  /** 取り込み元の Poll メッセージ ID。申請起点の行は null（§9.1）。 */
  registryMessageId: string | null;
  requestedAt: Date | null;
  actByAt: Date | null;
  completedAt: Date | null;
  /** 最後の `transferQuery` / Poll 応答（レジストリの生応答）。 */
  raw: unknown;
  createdAt: Date;
}

/** 新規行の入力（`id` / `createdAt` は DB が採番する）。 */
export type TransferInsert = Omit<TransferRecord, "id" | "createdAt">;

/** 進行中の行を確定させるときの差分。指定しなかった列は変更しない。 */
export interface TransferPatch {
  status?: TransferRecordStatus;
  registryStatus?: string | null;
  counterpartRegistrarId?: string | null;
  domainId?: string | null;
  requestedAt?: Date | null;
  actByAt?: Date | null;
  completedAt?: Date | null;
  raw?: unknown;
}

/** 移管行の永続化。テストではインメモリ実装に差し替える。 */
export interface TransferStore {
  /**
   * ユーザーの全移管行を新しい順（`created_at` 降順）で返す（FR-12 の一覧）。
   *
   * `created_at` はミリ秒精度なので、同一ミリ秒に作られた行どうしの順序は
   * `id` の昇順という**意味を持たない**タイブレークで決まる。表示順以上の意味を
   * ここに載せないこと（1 つのドメイン・向きに pending 行は 1 件、が本来の不変条件）。
   */
  list(userId: string): Promise<TransferRecord[]>;
  findById(id: string): Promise<TransferRecord | null>;
  /**
   * ユーザーの進行中（pending）の行だけを返す。
   * 一覧・詳細の移管バッジ（`domainSummarySchema.transfer`）を組み立てるのに使う。
   */
  listPending(userId: string): Promise<TransferRecord[]>;
  /**
   * ドメイン名 + 向きで進行中（pending）の行を 1 件引く。
   * Poll / `info` からの検知が既存行の更新か新規作成かを決めるのに使う。
   * 同じ組み合わせの pending 行は 1 件だけという前提で、複数あれば新しい方を返す。
   */
  findPending(
    domainName: string,
    direction: TransferDirection,
  ): Promise<TransferRecord | null>;
  /**
   * ドメイン名 + 向き + 状態で最新の行を 1 件引く（`created_at` 降順）。
   * pending 行が無い確定通知が「決着済みの移管 IN」か「取りこぼした移管 OUT」かの
   * 判別に使う（`handleSettlement`）。
   */
  findLatest(
    domainName: string,
    direction: TransferDirection,
    status: TransferRecordStatus,
  ): Promise<TransferRecord | null>;
  /**
   * Poll メッセージ ID で引く（`UNIQUE(registry, registry_message_id)`）。
   * 同じ通知を二重に取り込まないための冪等キー（§9.1）。
   */
  findByMessageId(
    registry: RegistryId,
    registryMessageId: string,
  ): Promise<TransferRecord | null>;
  create(values: TransferInsert): Promise<TransferRecord>;
  update(id: string, patch: TransferPatch): Promise<TransferRecord | null>;
}

type TransferRow = typeof schema.transfers.$inferSelect;

/**
 * DB の行 → アプリ内表現。
 * `direction` / `status` / `registry` は text 列なので、想定外の値（手動更新・
 * 将来の値追加）で一覧全体が落ちないよう既定値へ倒す（NFR-05）。
 */
export function toTransferRecord(row: TransferRow): TransferRecord {
  return {
    id: row.id,
    userId: row.userId,
    domainId: row.domainId,
    domainName: row.domainName,
    registry: registryIdSchema.catch("mock").parse(row.registry),
    direction: transferDirectionSchema.catch("in").parse(row.direction),
    status: transferRecordStatusSchema.catch("pending").parse(row.status),
    registryStatus: row.registryStatus,
    counterpartRegistrarId: row.counterpartRegistrarId,
    registryMessageId: row.registryMessageId,
    requestedAt: row.requestedAt,
    actByAt: row.actByAt,
    completedAt: row.completedAt,
    raw: row.raw,
    createdAt: row.createdAt,
  };
}

/** 差分 → UPDATE の SET 句。未指定のキーは落とす（undefined を書き込まないため）。 */
function toUpdateValues(patch: TransferPatch): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      values[key] = value;
    }
  }
  return values;
}

/** Drizzle 実装（本番）。 */
export function createDbTransferStore(db: Db): TransferStore {
  return {
    async list(userId) {
      const rows = await db
        .select()
        .from(schema.transfers)
        .where(eq(schema.transfers.userId, userId))
        .orderBy(desc(schema.transfers.createdAt), asc(schema.transfers.id));
      return rows.map(toTransferRecord);
    },

    async findById(id) {
      const rows = await db
        .select()
        .from(schema.transfers)
        .where(eq(schema.transfers.id, id))
        .limit(1);
      const row = rows[0];
      return row ? toTransferRecord(row) : null;
    },

    async listPending(userId) {
      const rows = await db
        .select()
        .from(schema.transfers)
        .where(
          and(
            eq(schema.transfers.userId, userId),
            eq(schema.transfers.status, "pending"),
          ),
        )
        .orderBy(desc(schema.transfers.createdAt));
      return rows.map(toTransferRecord);
    },

    async findPending(domainName, direction) {
      const rows = await db
        .select()
        .from(schema.transfers)
        .where(
          and(
            eq(schema.transfers.domainName, domainName),
            eq(schema.transfers.direction, direction),
            eq(schema.transfers.status, "pending"),
          ),
        )
        .orderBy(desc(schema.transfers.createdAt))
        .limit(1);
      const row = rows[0];
      return row ? toTransferRecord(row) : null;
    },

    async findLatest(domainName, direction, status) {
      const rows = await db
        .select()
        .from(schema.transfers)
        .where(
          and(
            eq(schema.transfers.domainName, domainName),
            eq(schema.transfers.direction, direction),
            eq(schema.transfers.status, status),
          ),
        )
        .orderBy(desc(schema.transfers.createdAt))
        .limit(1);
      const row = rows[0];
      return row ? toTransferRecord(row) : null;
    },

    async findByMessageId(registry, registryMessageId) {
      const rows = await db
        .select()
        .from(schema.transfers)
        .where(
          and(
            eq(schema.transfers.registry, registry),
            eq(schema.transfers.registryMessageId, registryMessageId),
          ),
        )
        .limit(1);
      const row = rows[0];
      return row ? toTransferRecord(row) : null;
    },

    async create(values) {
      const [row] = await db
        .insert(schema.transfers)
        .values(values)
        .returning();
      if (!row) {
        throw new Error("transfers の INSERT が行を返しませんでした");
      }
      return toTransferRecord(row);
    },

    async update(id, patch) {
      const values = toUpdateValues(patch);
      if (Object.keys(values).length === 0) {
        return this.findById(id);
      }
      const [row] = await db
        .update(schema.transfers)
        .set(values)
        .where(eq(schema.transfers.id, id))
        .returning();
      return row ? toTransferRecord(row) : null;
    },
  };
}

/** テスト用のインメモリ実装（DB を立てずにルートの認可・永続化を検証する）。 */
export function createInMemoryTransferStore(
  seed: TransferRecord[] = [],
): TransferStore {
  const byId = new Map<string, TransferRecord>(seed.map((r) => [r.id, r]));
  let sequence = seed.length;
  const store: TransferStore = {
    list: (userId) =>
      Promise.resolve(
        [...byId.values()]
          .filter((r) => r.userId === userId)
          .sort(
            (a, b) =>
              b.createdAt.getTime() - a.createdAt.getTime() ||
              a.id.localeCompare(b.id),
          ),
      ),
    findById: (id) => Promise.resolve(byId.get(id) ?? null),
    listPending: (userId) =>
      Promise.resolve(
        [...byId.values()]
          .filter((r) => r.userId === userId && r.status === "pending")
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      ),
    findPending: (domainName, direction) =>
      Promise.resolve(
        [...byId.values()]
          .filter(
            (r) =>
              r.domainName === domainName &&
              r.direction === direction &&
              r.status === "pending",
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ??
          null,
      ),
    findLatest: (domainName, direction, status) =>
      Promise.resolve(
        [...byId.values()]
          .filter(
            (r) =>
              r.domainName === domainName &&
              r.direction === direction &&
              r.status === status,
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ??
          null,
      ),
    findByMessageId: (registry, registryMessageId) =>
      Promise.resolve(
        [...byId.values()].find(
          (r) =>
            r.registry === registry &&
            r.registryMessageId === registryMessageId,
        ) ?? null,
      ),
    create: (values) => {
      sequence += 1;
      // DB の defaultRandom() 相当。テスト内で安定した並び順になるよう連番を埋める
      const id = `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
      const record: TransferRecord = { ...values, id, createdAt: new Date() };
      byId.set(id, record);
      return Promise.resolve(record);
    },
    update: (id, patch) => {
      const current = byId.get(id);
      if (!current) {
        return Promise.resolve(null);
      }
      const updated = {
        ...current,
        ...toUpdateValues(patch),
      } as TransferRecord;
      byId.set(id, updated);
      return Promise.resolve(updated);
    },
  };
  return store;
}

let override: TransferStore | null = null;

/** 移管行のストア（本番は DB、テストでは差し替え）。 */
export function getTransferStore(): TransferStore {
  return override ?? createDbTransferStore(getDb());
}

/** テスト専用: ストアを差し替える。null で既定（DB）に戻す。本番コードからは呼ばない。 */
export function setTransferStoreForTesting(store: TransferStore | null): void {
  override = store;
}
