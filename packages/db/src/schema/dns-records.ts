import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { domains } from "./domains";

/**
 * 疑似 DNS ゾーン（docs/requirements.md §9.1 dns_records / FR-13）。
 *
 * アプリ内だけのゾーンで、実インターネットには公開しない。サブドメイン設計
 * （`subdomain_plans`）を「DNS に反映」したときの反映先で、設計から消えたホストの行は
 * apply で削除される。値域（`record_type` / `source`）と差分計算は packages/shared の
 * `subdomains.ts`（`DNS_RECORD_TYPES` / `diffDnsRecords`）が正。
 *
 * `UNIQUE(domain_id, host, record_type)` により、同じホストに同種のレコードは 1 件だけ持つ
 * （apply は差分 upsert なのでこの一意制約が競合検出のキーになる）。
 */
export const dnsRecords = pgTable(
  "dns_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    domainId: uuid("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
    // www / api / @（apex）。1 ラベルまたは "@"（packages/shared の subdomainHostSchema）
    host: text("host").notNull(),
    // A / CNAME / ALIAS（packages/shared の DNS_RECORD_TYPES）
    recordType: text("record_type").notNull(),
    // 例: cname.vercel-dns.com（末尾ドットは落として保持する）
    target: text("target").notNull(),
    ttl: integer("ttl").notNull().default(3600),
    // subdomain_plan（設計からの反映）。将来の手動編集用に予約（DNS_RECORD_SOURCES）
    source: text("source").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("dns_records_domain_id_idx").on(t.domainId),
    unique("dns_records_domain_id_host_record_type_uniq").on(
      t.domainId,
      t.host,
      t.recordType,
    ),
  ],
);
