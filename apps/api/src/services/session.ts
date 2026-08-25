import { type Db, schema } from "@dopamin/db";
import { eq } from "drizzle-orm";

/** db.transaction のコールバックに渡るトランザクションも受け取れるようにした型 */
export type DbLike = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 日
const EXTEND_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000; // 残り 3 日を切ったら延長

/** 32 byte ランダムの不透明トークン（base64url）。Cookie 値そのもの（§12.3） */
function newSessionId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export async function createSession(
  db: DbLike,
  userId: string,
  userAgent?: string,
): Promise<string> {
  const id = newSessionId();
  await db.insert(schema.sessions).values({
    id,
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    userAgent,
  });
  return id;
}

export async function deleteSession(db: DbLike, id: string): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.id, id));
}

/** セッションとユーザーを引く。存在しない・期限切れなら null */
export async function getSessionWithUser(db: Db, id: string) {
  const rows = await db
    .select({ session: schema.sessions, user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(eq(schema.sessions.id, id))
    .limit(1);
  const row = rows[0];
  if (!row || row.session.expiresAt.getTime() <= Date.now()) {
    return null;
  }
  return row;
}

/** 期限が近ければ 7 日に延長する（§10.2）。延長したら true */
export async function extendSessionIfNeeded(
  db: Db,
  session: { id: string; expiresAt: Date },
): Promise<boolean> {
  if (session.expiresAt.getTime() - Date.now() > EXTEND_THRESHOLD_MS) {
    return false;
  }
  await db
    .update(schema.sessions)
    .set({ expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
    .where(eq(schema.sessions.id, session.id));
  return true;
}
