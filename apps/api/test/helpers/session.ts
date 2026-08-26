import { type Db, schema } from "@dopamin/db";
import type { AuthUser } from "@dopamin/shared";
import { SESSION_COOKIE } from "../../src/lib/cookies";
import { setSessionResolverForTesting } from "../../src/middleware/session";

/** テスト用のログインユーザー。 */
export const TEST_USER: AuthUser = {
  id: "00000000-0000-4000-8000-000000000001",
  displayName: "テストユーザー",
};

/** 所有権チェック（NFR-04）の検証に使う別ユーザー。 */
export const OTHER_USER: AuthUser = {
  id: "00000000-0000-4000-8000-000000000002",
  displayName: "別のユーザー",
};

const VALID_SESSION_ID = "test-session";

/** 認証済みリクエスト用の Cookie ヘッダ。 */
export const SESSION_COOKIE_HEADER = `dopamin_session=${VALID_SESSION_ID}`;

/**
 * セッション解決だけを差し替える（Cookie 検証・401 は本番と同じ経路を通る）。
 * DB を立てずに認証必須ルートの中身を検証するための seam。
 */
export function installTestSession(user: AuthUser = TEST_USER): void {
  setSessionResolverForTesting((sessionId) =>
    Promise.resolve(
      sessionId === VALID_SESSION_ID
        ? { user, sessionId, extended: false }
        : null,
    ),
  );
}

export function clearTestSession(): void {
  setSessionResolverForTesting(null);
}

// ---- DB 込みのテスト（pglite）用: 本物の users / sessions 行を作る ----

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 日（services/session.ts と同じ）

/** 本番と同じ形式（32 byte ランダム → base64url）のセッション ID */
function randomSessionId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

/**
 * テスト用のユーザーとセッションを INSERT し、リクエストの `cookie` ヘッダに
 * そのまま入れられる文字列（`dopamin_session=<sessionId>`）を返す。
 * `createTestDb()` + `setDbForTesting(db)` と組で使い、requireSession を DB 参照のまま通す
 * 統合テスト用（installTestSession は DB を立てずにセッション解決だけを差し替える seam）。
 * services/session.ts には依存させない（セッション発行ロジック自体をテストするときの独立性のため）。
 */
export async function createTestSession(
  db: Db,
  opts: {
    displayName?: string;
    aiProvider?: string | null;
    aiModel?: string | null;
  } = {},
): Promise<{
  user: { id: string; displayName: string };
  sessionId: string;
  cookie: string;
}> {
  const users = await db
    .insert(schema.users)
    .values({
      displayName: opts.displayName ?? "テストユーザー",
      aiProvider: opts.aiProvider ?? null,
      aiModel: opts.aiModel ?? null,
    })
    .returning({ id: schema.users.id, displayName: schema.users.displayName });
  const user = users[0];
  if (!user) {
    throw new Error(
      "createTestSession: users の INSERT が行を返しませんでした",
    );
  }
  const sessionId = randomSessionId();
  await db.insert(schema.sessions).values({
    id: sessionId,
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    userAgent: "vitest",
  });
  return { user, sessionId, cookie: `${SESSION_COOKIE}=${sessionId}` };
}
