import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    // マイグレーションは Supavisor session mode（5432）を使う。transaction mode（6543）は DDL に使わない
    // （直結の 5432 でもよいが IPv6 のみのため CI からは届かない。docs/requirements.md §16.3）
    url: process.env.DIRECT_DATABASE_URL ?? "",
  },
});
