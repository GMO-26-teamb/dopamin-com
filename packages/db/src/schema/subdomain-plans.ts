import {
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { domains } from "./domains";

/**
 * サブドメイン設計（docs/requirements.md §9.1 subdomain_plans / FR-13）。
 *
 * AI の提案をユーザーが編集したものを「設計」としてドメインに 1 件だけ紐付けて保存する。
 * 保存しただけでは疑似 DNS ゾーン（`dns_records`）は変わらず、`applied_at` が NULL のままになる。
 * 「DNS に反映」（`POST /domains/:name/subdomain-plan/apply`）で `dns_records` を upsert し、
 * このテーブルの `applied_at` を更新する。
 *
 * `proposal` の形は packages/shared の `subdomainProposalSchema`（`{ policy, items }`）が正で、
 * 読み出し時に必ず zod で検証してから使う（NFR-05。DB は jsonb として素通しする）。
 * ドメインが消えたら設計も残す意味が無いので FK は ON DELETE CASCADE。
 */
export const subdomainPlans = pgTable(
  "subdomain_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    domainId: uuid("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
    // https://github.com/<owner>/<repo>。description だけで生成した設計では NULL
    repoUrl: text("repo_url"),
    // GitHub 解析の結果（言語・構造ヒント・README 抜粋）。再提案時の入力に使う
    repoSummary: jsonb("repo_summary"),
    // { policy: string, items: SubdomainItem[] }（packages/shared の subdomainProposalSchema）
    proposal: jsonb("proposal").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // 最後に「DNS に反映」した日時。未反映は NULL（§9.1 / AC-13-3）
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  // 1 ドメイン 1 設計（PUT は upsert になる。§10.1 / FR-13）
  (t) => [unique("subdomain_plans_domain_id_uniq").on(t.domainId)],
);
