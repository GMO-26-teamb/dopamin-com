import { type Db, schema } from "@dopamin/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../lib/db";
import { ApiException } from "../lib/errors";
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
  /**
   * 保有行を作る / 更新する。**取得経路専用**（新規登録 FR-06 / 移管 IN の取り込み FR-12 / デモ投入）。
   *
   * 同名の `transferred_out` 行の隣に `owned` 行を作れることが要件（AC-12-5 の「出戻り」）なので、
   * INSERT を止めない。逆に言えば `info` の write-through から呼んではいけない
   * （移管 OUT 済みのドメインが保有一覧に復活する。#251 と {@link updateOwned} を参照）。
   */
  upsert(record: DomainUpsert): Promise<DomainRecord>;
  /**
   * **既にある保有行だけ**を最新の `info` で上書きする（§6.5 の write-through）。
   * 保有行が無ければ何も書かずに null（移管 OUT 済み / 削除済み / 他ユーザーの行）。
   *
   * `upsert` と違って INSERT しないのが要点（#251）。`domains_name_owned_uniq` は
   * `ownership = 'owned'` の部分一意インデックスなので、`info` を取っている間に
   * `markTransferredOut` が割り込むと `upsert` の ON CONFLICT が何にも当たらず、
   * `transferred_out` 行の隣に `owned` 行を新規 INSERT してしまう。
   * こうなると保有一覧に復活したまま `sync` でも消えず、復旧経路が無くなる。
   */
  updateOwned(record: DomainUpsert): Promise<DomainRecord | null>;
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

/**
 * 「同名の保有行が別ユーザーのものだった」ときのエラー（#222 / NFR-04）。
 *
 * `upsert` の最後の砦なので、通常はここまで来ない（登録は `POST /domains` が
 * 事前に旧行を片付け、移管の取り込みは `requireNotOwnedByOtherUser` が弾く）。
 * §10.3 の FORBIDDEN = 所有権なしに合わせ、内部の表・列名は出さない。
 */
function ownershipConflict(): ApiException {
  return new ApiException(
    "FORBIDDEN",
    "このドメインを操作する権限がありません。",
  );
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
      // レジストリが正なので、保有中の同名行は最新の情報で上書きする。
      // transferred_out の履歴行は索引に入らないので触らない。
      //
      // setWhere で「所有者が同じ行」に限って更新する（#222 / NFR-04 / §6.5）。
      // domains.id は subdomain_plans / dns_records / transfers の FK なので、
      // 他ユーザーの行の user_id だけを書き換えると旧所有者の設計・DNS レコード・
      // 移管履歴がそのまま新所有者のものになる。所有者が変わるときは新しい行を作るのが
      // §6.5 の決まりで、その前段（旧行の後始末）は呼び出し側の責務。
      // 条件から外れると 0 行 = RETURNING が空になるので、乗っ取る代わりにここで止める。
      const [row] = await db
        .insert(schema.domains)
        .values(values)
        .onConflictDoUpdate({
          target: schema.domains.name,
          targetWhere: eq(schema.domains.ownership, "owned"),
          set: values,
          setWhere: eq(schema.domains.userId, record.userId),
        })
        .returning();
      if (!row) {
        throw ownershipConflict();
      }
      return toDomainRecord(row);
    },

    async updateOwned(record) {
      // INSERT を持たない UPDATE 1 文。「保有中」「所有者が自分」を WHERE で見るので、
      // 判定と書き込みが同じ文の中で起きる = 読んでから書くまでの窓が無い（#251）。
      const [row] = await db
        .update(schema.domains)
        .set(toDomainValues(record))
        .where(
          and(
            eq(schema.domains.name, record.name),
            eq(schema.domains.ownership, "owned"),
            eq(schema.domains.userId, record.userId),
          ),
        )
        .returning();
      return row ? toDomainRecord(row) : null;
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
      // DB 実装の setWhere と同じガード（#222）。他ユーザーの保有行は乗っ取らない
      if (
        existing &&
        existing.ownership === "owned" &&
        existing.userId !== record.userId
      ) {
        return Promise.reject(ownershipConflict());
      }
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
    updateOwned: (record) => {
      // DB 実装の WHERE と同じ条件（保有中 + 所有者が自分）。無ければ書かない
      const existing = byName.get(record.name);
      if (
        existing?.ownership !== "owned" ||
        existing.userId !== record.userId
      ) {
        return Promise.resolve(null);
      }
      const updated: DomainRecord = {
        ...record,
        id: existing.id,
        // `rgp_until` は toDomainValues に無い = DB の UPDATE でも触らない列
        rgpUntil: existing.rgpUntil,
      };
      byName.set(record.name, updated);
      return Promise.resolve(updated);
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
