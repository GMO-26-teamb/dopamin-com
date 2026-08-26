import { type Db, schema } from "@dopamin/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../../src/index";
import { setDbForTesting } from "../../src/lib/db";
import { createTestDb, resetTestDb } from "./db";
import { createTestSession } from "./session";

let db: Db;
let closeDb: (() => Promise<void>) | undefined;

beforeAll(async () => {
  // env() は遅延評価。DB は注入するので DATABASE_URL はダミーでよい
  process.env.DATABASE_URL = "postgres://unused:unused@localhost:1/unused";
  process.env.WEBAUTHN_RP_ID = "localhost";
  process.env.WEBAUTHN_ORIGIN = "http://localhost:3000";
  ({ db, close: closeDb } = await createTestDb());
  setDbForTesting(db);
}, 30_000);

afterAll(async () => {
  setDbForTesting(null);
  // beforeAll が timeout した場合は未代入。ここで TypeError を出すと本来の原因を隠すので省略可能にする
  await closeDb?.();
});

// 各ケースを空の DB から始める（sessions の行数検証を実行順に依存させない）
beforeEach(() => resetTestDb(db));

describe("createTestSession", () => {
  it("users と sessions を 1 行ずつ作り、cookie は dopamin_session=<sessionId>", async () => {
    const { user, sessionId, cookie } = await createTestSession(db, {
      displayName: "たくたく",
    });
    expect(user.displayName).toBe("たくたく");
    expect(cookie).toBe(`dopamin_session=${sessionId}`);

    const sessions = await db.select().from(schema.sessions);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: sessionId, userId: user.id });
    // 7 日後（前後 1 分の誤差を許容）
    const ttl = (sessions[0]?.expiresAt.getTime() ?? 0) - Date.now();
    expect(ttl).toBeGreaterThan(7 * 24 * 60 * 60 * 1000 - 60_000);
    expect(ttl).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
  });

  it("cookie を付けると requireSession を通過して GET /auth/me が 200 でそのユーザーを返す", async () => {
    const { user, cookie } = await createTestSession(db, {
      displayName: "ログイン済み",
    });
    const res = await app.request("/api/v1/auth/me", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      user: { id: user.id, displayName: "ログイン済み" },
    });
  });

  it("aiProvider / aiModel を指定すると users に保存される", async () => {
    const { user } = await createTestSession(db, {
      aiProvider: "anthropic",
      aiModel: "claude-test",
    });
    const rows = await db.select().from(schema.users);
    const saved = rows.find((r) => r.id === user.id);
    expect(saved).toMatchObject({
      aiProvider: "anthropic",
      aiModel: "claude-test",
    });
  });

  it("存在しないセッション ID の cookie は 401 UNAUTHORIZED", async () => {
    const res = await app.request("/api/v1/auth/me", {
      headers: { cookie: "dopamin_session=not-a-session" },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      error: { code: "UNAUTHORIZED" },
    });
  });

  it("期限切れセッションの cookie は 401 UNAUTHORIZED", async () => {
    const { user } = await createTestSession(db);
    await db.insert(schema.sessions).values({
      id: "expired-session",
      userId: user.id,
      expiresAt: new Date(Date.now() - 1_000),
    });
    const res = await app.request("/api/v1/auth/me", {
      headers: { cookie: "dopamin_session=expired-session" },
    });
    expect(res.status).toBe(401);
  });
});
