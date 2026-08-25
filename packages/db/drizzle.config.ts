import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    // マイグレーションは Supavisor ではなく直結（5432）を使う（docs/requirements.md §16.3）
    url: process.env.DIRECT_DATABASE_URL ?? "",
  },
});
