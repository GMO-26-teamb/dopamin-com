import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    // マイグレーションは直結（5432）または Supavisor session mode（5432）を使う。
    // transaction mode（6543）は DDL に使わない。ローカルから手で当てる運用なので直結でよい
    // （直結ホストは IPv6 のみ。IPv4 だけの環境から当てるときは session mode。docs/requirements.md §16.2 / §16.3）
    url: process.env.DIRECT_DATABASE_URL ?? "",
  },
});
