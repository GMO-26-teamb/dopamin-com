import { type Db, schema } from "@dopamin/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../lib/db";
import {
  type DomainRecord,
  toDomainRecord,
  toDomainValues,
} from "./domain-row";

export type { DomainRecord } from "./domain-row";

/** 保有ドメインの永続化。テストではインメモリ実装に差し替える。 */
export interface DomainStore {
  /** ユーザーの保有ドメインを名前順で返す（FR-02）。 */
  list(userId: string): Promise<DomainRecord[]>;
  /**
   * FQDN で 1 件引く。所有者で絞らないのは、他ユーザーのドメインを
   * 404（存在しない）ではなく 403（所有権なし）で返し分けるため（§10.3）。
   */
  find(name: string): Promise<DomainRecord | null>;
  upsert(record: DomainRecord): Promise<DomainRecord>;
  remove(name: string): Promise<void>;
}

/** Drizzle 実装（本番）。行 ↔ レコードの写像は domain-row.ts（純粋関数）に置く。 */
export function createDbDomainStore(db: Db): DomainStore {
  return {
    async list(userId) {
      const rows = await db
        .select()
        .from(schema.domains)
        .where(eq(schema.domains.userId, userId))
        .orderBy(asc(schema.domains.name));
      return rows.map(toDomainRecord);
    },

    async find(name) {
      // 同名で transferred_out の履歴行が残り得る（§9.1 の部分一意）。
      // 保有中の行を優先し、無ければ最後に移管 OUT した行を返す（AC-12-5 の「移管済み」表示用）。
      const rows = await db
        .select()
        .from(schema.domains)
        .where(eq(schema.domains.name, name))
        .orderBy(
          desc(sql`${schema.domains.ownership} = 'owned'`),
          desc(schema.domains.createdAt),
        )
        .limit(1);
      const row = rows[0];
      return row ? toDomainRecord(row) : null;
    },

    async upsert(record) {
      const values = toDomainValues(record);
      // 一意なのは保有中の行だけ（部分一意インデックス domains_name_owned_uniq、§9.1）。
      // ON CONFLICT の推論も同じ述語で絞らないと制約に一致せず失敗するため targetWhere を付ける。
      // レジストリが正なので、保有中の同名行は最新の所有者・情報で上書きする
      // （移管 IN / 廃止後の再取得で所有者が変わり得る）。transferred_out の履歴行は触らない。
      const [row] = await db
        .insert(schema.domains)
        .values(values)
        .onConflictDoUpdate({
          target: schema.domains.name,
          targetWhere: eq(schema.domains.ownership, "owned"),
          set: values,
        })
        .returning();
      return row ? toDomainRecord(row) : record;
    },

    async remove(name) {
      // 移管 OUT 済みの履歴行は残す（§6.5）。消すのは保有中の行だけ。
      await db
        .delete(schema.domains)
        .where(
          and(
            eq(schema.domains.name, name),
            eq(schema.domains.ownership, "owned"),
          ),
        );
    },
  };
}

/** テスト用のインメモリ実装（DB を立てずにルートの認可・永続化を検証する）。 */
export function createInMemoryDomainStore(
  seed: DomainRecord[] = [],
): DomainStore {
  const byName = new Map<string, DomainRecord>(seed.map((r) => [r.name, r]));
  return {
    list: (userId) =>
      Promise.resolve(
        [...byName.values()]
          .filter((r) => r.userId === userId)
          .sort((a, b) => a.name.localeCompare(b.name)),
      ),
    find: (name) => Promise.resolve(byName.get(name) ?? null),
    upsert: (record) => {
      byName.set(record.name, record);
      return Promise.resolve(record);
    },
    remove: (name) => {
      byName.delete(name);
      return Promise.resolve();
    },
  };
}

let override: DomainStore | null = null;

/** 保有ドメインのストア（本番は DB、テストでは差し替え）。 */
export function getDomainStore(): DomainStore {
  return override ?? createDbDomainStore(getDb());
}

/** テスト専用: ストアを差し替える。null で既定（DB）に戻す。本番コードからは呼ばない。 */
export function setDomainStoreForTesting(store: DomainStore | null): void {
  override = store;
}
