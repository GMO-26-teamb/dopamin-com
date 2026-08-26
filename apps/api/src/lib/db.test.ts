import { schema } from "@dopamin/db";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterEach, describe, expect, it } from "vitest";
import { getDb, setDbForTesting } from "./db";

afterEach(() => {
  setDbForTesting(null);
});

describe("setDbForTesting", () => {
  it("注入した Db を getDb() がそのまま返す", () => {
    // 接続を持たないスタブ（drizzle.mock）。クエリは実行しない
    const injected = drizzle.mock({ schema });
    setDbForTesting(injected);
    expect(getDb()).toBe(injected);
  });

  it("null を渡すと注入が解除され、次回は環境変数から構築する", () => {
    process.env.DATABASE_URL = "postgres://unused:unused@localhost:1/unused";
    process.env.WEBAUTHN_RP_ID = "localhost";
    process.env.WEBAUTHN_ORIGIN = "http://localhost:3000";
    const injected = drizzle.mock({ schema });
    setDbForTesting(injected);
    setDbForTesting(null);
    // postgres.js は最初のクエリまで接続しないため、生成だけなら接続不要
    const rebuilt = getDb();
    expect(rebuilt).not.toBe(injected);
    // 再構築後はキャッシュされる
    expect(getDb()).toBe(rebuilt);
  });
});
