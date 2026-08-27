import { type Db, schema } from "@dopamin/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../lib/db";
import {
  type DomainRecord,
  type DomainUpsert,
  toDomainRecord,
  toDomainValues,
} from "./domain-row";

export type { DomainRecord, DomainUpsert } from "./domain-row";

/** 保有ドメインの永続化。テストではインメモリ実装に差し替える。 */
export interface DomainStore {
  /**
   * ユーザーの**保有中**（`ownership = 'owned'`）のドメインを名前順で返す（FR-02）。
   *
   * 移管 OUT 済みの行は含めない（§6.5 / AC-12-5。履歴は `/transfers` 側で見る）。
   * 一覧の再同期（`POST /domains/sync`）も同じ集合を対象にする: 自レジストラが
   * スポンサーでないドメインに `info` を投げても結果を信頼できないため。
   */
  list(userId: string): Promise<DomainRecord[]>;
  /**
   * FQDN で 1 件引く。所有者で絞らないのは、他ユーザーのドメインを
   * 404（存在しない）ではなく 403（所有権なし）で返し分けるため（§10.3）。
   */
  find(name: string): Promise<DomainRecord | null>;
  upsert(record: DomainUpsert): Promise<DomainRecord>;
  remove(name: string): Promise<void>;
  /**
   * 保有中の行を移管 OUT 済みに遷移させる（§6.5 / AC-12-5）。行は消さず履歴として残す。
   * 保有中の行が無ければ null（既に遷移済み・他社保有）。
   *
   * `upsert` では代用できない: `domains_name_owned_uniq` は `ownership = 'owned'` の
   * 部分一意インデックスなので、`transferred_out` の行を INSERT しても衝突が起きず、
   * 既存行を更新せずに重複行が増えてしまう。
   */
  markTransferredOut(name: string, at: Date): Promise<DomainRecord | null>;
}

/** Drizzle 実装（本番）。行 ↔ レコードの写像は domain-row.ts（純粋関数）に置く。 */
export function createDbDomainStore(db: Db): DomainStore {
  return {
    async list(userId) {
      const rows = await db
        .select()
        .from(schema.domains)
        .where(
          and(
            eq(schema.domains.userId, userId),
            eq(schema.domains.ownership, "owned"),
          ),
        )
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
      return row
        ? toDomainRecord(row)
        : { ...record, id: null, rgpUntil: null };
    },

    async markTransferredOut(name, at) {
      const [row] = await db
        .update(schema.domains)
        .set({ ownership: "transferred_out", transferredOutAt: at })
        .where(
          and(
            eq(schema.domains.name, name),
            eq(schema.domains.ownership, "owned"),
          ),
        )
        .returning();
      return row ? toDomainRecord(row) : null;
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

/**
 * `domains.rgp_until` を直接書く（FR-16 のデモ投入専用）。
 *
 * 通常経路（`upsertDomainFromInfo` → `toDomainValues`）はこの列を書かない
 * （両レジストリの `info` が猶予期限を返さないため）。書かないので、ここで入れた値は
 * その後の再同期でも消えない。デモでは「残日数つきの RGP」を見せたいので、
 * §11.4 の目安日数を実データとして入れる。
 *
 * この列が空のまま（= 期限が分からない）の行は、`toDomainSummary` が `rgpUntil: null`
 * を返し、画面は残日数を出さない（0 日と偽らない・#211）。
 *
 * `DomainStore` の口にはしない: 書き込みの用途がデモしか無く、読み出しは
 * `toDomainRecord` が行から拾うため。
 */
export async function setDomainRgpUntil(
  db: Db,
  domainId: string,
  rgpUntil: Date,
): Promise<void> {
  await db
    .update(schema.domains)
    .set({ rgpUntil })
    .where(eq(schema.domains.id, domainId));
}

/** テスト用のインメモリ実装（DB を立てずにルートの認可・永続化を検証する）。 */
export function createInMemoryDomainStore(
  seed: DomainRecord[] = [],
): DomainStore {
  const byName = new Map<string, DomainRecord>(seed.map((r) => [r.name, r]));
  let sequence = seed.length;
  return {
    list: (userId) =>
      Promise.resolve(
        [...byName.values()]
          .filter((r) => r.userId === userId && r.ownership === "owned")
          .sort((a, b) => a.name.localeCompare(b.name)),
      ),
    find: (name) => Promise.resolve(byName.get(name) ?? null),
    upsert: (record) => {
      // DB の defaultRandom() 相当。同名の行を上書きするときは ID を保つ
      const existing = byName.get(record.name);
      sequence += 1;
      const id =
        existing?.id ??
        `00000000-0000-4000-9000-${String(sequence).padStart(12, "0")}`;
      // `rgp_until` は toDomainValues に無い = DB の upsert でも更新されない列なので、
      // ここでも既存値を残す（info の write-through で猶予期限が消えないこと）
      const stored: DomainRecord = {
        ...record,
        id,
        rgpUntil: existing?.rgpUntil ?? null,
      };
      byName.set(record.name, stored);
      return Promise.resolve(stored);
    },
    remove: (name) => {
      byName.delete(name);
      return Promise.resolve();
    },
    // `at`（遷移日時）はインメモリ実装では保持しない。DomainRecord に
    // transferred_out_at を持たせていないため（一覧・詳細の判定に使わない）
    markTransferredOut: (name) => {
      const existing = byName.get(name);
      if (existing?.ownership !== "owned") {
        return Promise.resolve(null);
      }
      const updated: DomainRecord = {
        ...existing,
        ownership: "transferred_out",
      };
      byName.set(name, updated);
      return Promise.resolve(updated);
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
