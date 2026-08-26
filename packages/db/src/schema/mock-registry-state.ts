import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * mock レジストリの状態（docs/requirements.md §11.1「インメモリ + DB」/ §16.1）。
 *
 * `REGISTRY_MODE=mock` のときだけ使う**デモ・検証専用**のテーブル。
 * Vercel Functions はインスタンスが変わると `MockRegistryAdapter` のプロセス内 Map が
 * 消えるので、create したドメインが次のリクエストの `info` で 2303 になってしまう。
 * その状態をここに逃がす。
 *
 * `domains` を流用せず専用テーブルにしたのは、**アプリのデータとレジストリの状態を
 * 混ぜないため**。`domains` はユーザーの保有（`ownership` 込み）を表す DB キャッシュで、
 * こちらは「レジストリ側に何があるか」。混ぜると FR-16 のデモリセットで
 * 片方だけ消す・所有権の判定が壊れるといった事故になる。
 *
 * 1 レジストリ = 1 行（状態一式の JSON）。行単位に分けないのは mock の 1 操作が
 * 複数ドメイン・複数キューをまたいで状態を変えるため（移管の確定は両当事者に通知を積む）。
 * 同時実行は後勝ちで、実レジストリの代替ではないので割り切る。
 */
export const mockRegistryState = pgTable("mock_registry_state", {
  /** レジストリ ID（kitaqsign / kitaqnic / mock）。 */
  registry: text("registry").primaryKey(),
  /** `MockStateSnapshot`（`packages/registry`）をそのまま入れる。 */
  snapshot: jsonb("snapshot").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
