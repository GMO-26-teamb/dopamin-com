import { type Db, schema } from "@dopamin/db";
import type {
  AuthUser,
  PasskeySummary,
  PasskeyVerifyRequest,
} from "@dopamin/shared";
import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { and, asc, eq, lt } from "drizzle-orm";
import { passkeyNameFromAaguid } from "../lib/aaguid";
import { env } from "../lib/env";
import { ApiException } from "../lib/errors";
import { createSession } from "./session";

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 分（§12.4）

/** user handle は users.id（UUID 文字列）を UTF-8 バイト化したもの（FR-01 spec §1） */
function userIdToHandle(userId: string): Uint8Array<ArrayBuffer> {
  // 新しい ArrayBuffer にコピーして返す（TS の Uint8Array<ArrayBufferLike> と区別されるため）
  return new Uint8Array(new TextEncoder().encode(userId));
}

/**
 * チャレンジを取得と同時に削除する（1 回限りの保証。§12.4）。
 * 検証に失敗した場合もチャレンジは再利用させず、最初からやり直してもらう。
 */
async function consumeChallenge(
  db: Db,
  id: string,
  type: "registration" | "authentication",
) {
  const rows = await db
    .delete(schema.webauthnChallenges)
    .where(
      and(
        eq(schema.webauthnChallenges.id, id),
        eq(schema.webauthnChallenges.type, type),
      ),
    )
    .returning();
  const row = rows[0];
  if (!row || row.expiresAt.getTime() <= Date.now()) {
    throw new ApiException(
      "CHALLENGE_NOT_FOUND",
      "チャレンジが無効です。もう一度やり直してください。",
    );
  }
  return row;
}

/**
 * 期限切れチャレンジを opportunistic に掃除する（FR-01 spec §7）。
 * cron は持たず、options 発行のたびに expires_at < now() の行を消す。
 */
async function deleteExpiredChallenges(db: Db): Promise<void> {
  await db
    .delete(schema.webauthnChallenges)
    .where(lt(schema.webauthnChallenges.expiresAt, new Date()));
}

async function insertChallenge(
  db: Db,
  values: {
    challenge: string;
    type: "registration" | "authentication";
    userId?: string;
    displayName?: string;
  },
): Promise<string> {
  await deleteExpiredChallenges(db);
  const rows = await db
    .insert(schema.webauthnChallenges)
    .values({
      ...values,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    })
    .returning({ id: schema.webauthnChallenges.id });
  const row = rows[0];
  if (!row) {
    throw new ApiException("INTERNAL", "チャレンジの保存に失敗しました。");
  }
  return row.id;
}

/** 登録レスポンスを SimpleWebAuthn で検証し、保存すべき資格情報を返す */
async function verifyRegistrationOrThrow(
  expectedChallenge: string,
  response: PasskeyVerifyRequest["response"],
) {
  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response: response as unknown as RegistrationResponseJSON,
      expectedChallenge,
      expectedOrigin: env().WEBAUTHN_ORIGIN,
      expectedRPID: env().WEBAUTHN_RP_ID,
      requireUserVerification: false, // userVerification: 'preferred' のため（FR-01 spec §5）
    });
  } catch (e) {
    console.warn("[auth] registration verify failed:", e);
    throw new ApiException(
      "VERIFICATION_FAILED",
      "パスキーの検証に失敗しました。",
    );
  }
  if (!verification.verified || !verification.registrationInfo) {
    throw new ApiException(
      "VERIFICATION_FAILED",
      "パスキーの検証に失敗しました。",
    );
  }
  return verification.registrationInfo;
}

// ---- サインアップ（FR-01 spec §3.1） ----

export async function createRegistrationOptions(db: Db, displayName: string) {
  // users 行はまだ作らない。ID だけ事前採番してチャレンジに保存する
  const userId = crypto.randomUUID();
  const options = await generateRegistrationOptions({
    rpName: env().WEBAUTHN_RP_NAME,
    rpID: env().WEBAUTHN_RP_ID,
    userID: userIdToHandle(userId),
    userName: displayName,
    userDisplayName: displayName,
    attestationType: "none",
    excludeCredentials: [],
    authenticatorSelection: {
      residentKey: "required", // Discoverable Credential にする
      userVerification: "preferred",
    },
  });
  const challengeId = await insertChallenge(db, {
    challenge: options.challenge,
    type: "registration",
    userId,
    displayName,
  });
  return { challengeId, options };
}

export async function verifyRegistration(
  db: Db,
  input: PasskeyVerifyRequest,
  userAgent?: string,
): Promise<{ user: AuthUser; sessionId: string }> {
  const challenge = await consumeChallenge(
    db,
    input.challengeId,
    "registration",
  );
  if (!challenge.userId || !challenge.displayName) {
    throw new ApiException("CHALLENGE_NOT_FOUND", "チャレンジが無効です。");
  }
  const info = await verifyRegistrationOrThrow(
    challenge.challenge,
    input.response,
  );
  const user: AuthUser = {
    id: challenge.userId,
    displayName: challenge.displayName,
  };
  // verify 成功時に初めて users を作る（途中離脱で空ユーザーを残さない）
  const sessionId = await db.transaction(async (tx) => {
    await tx
      .insert(schema.users)
      .values({ id: user.id, displayName: user.displayName });
    await tx.insert(schema.passkeyCredentials).values({
      id: info.credential.id,
      userId: user.id,
      publicKey: info.credential.publicKey,
      counter: info.credential.counter,
      transports: info.credential.transports,
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
      aaguid: info.aaguid,
      name: passkeyNameFromAaguid(info.aaguid, info.credentialDeviceType),
    });
    return createSession(tx, user.id, userAgent);
  });
  return { user, sessionId };
}

// ---- ログイン（FR-01 spec §3.2） ----

export async function createAuthenticationOptions(db: Db) {
  const options = await generateAuthenticationOptions({
    rpID: env().WEBAUTHN_RP_ID,
    allowCredentials: [], // 空 = Discoverable Credential（ユーザー名入力なし）
    userVerification: "preferred",
  });
  const challengeId = await insertChallenge(db, {
    challenge: options.challenge,
    type: "authentication",
  });
  return { challengeId, options };
}

export async function verifyAuthentication(
  db: Db,
  input: PasskeyVerifyRequest,
  userAgent?: string,
): Promise<{ user: AuthUser; sessionId: string }> {
  const challenge = await consumeChallenge(
    db,
    input.challengeId,
    "authentication",
  );

  // 誰がログインするかは credential ID から引く
  const creds = await db
    .select()
    .from(schema.passkeyCredentials)
    .where(eq(schema.passkeyCredentials.id, input.response.id))
    .limit(1);
  const cred = creds[0];
  if (!cred) {
    throw new ApiException(
      "CREDENTIAL_NOT_FOUND",
      "このパスキーは登録されていません。",
    );
  }

  // userHandle が返ってきた場合は user_id と一致することを確認（FR-01 spec §3.2）
  const userHandle = (input.response.response as { userHandle?: unknown })
    .userHandle;
  if (typeof userHandle === "string" && userHandle.length > 0) {
    const decoded = Buffer.from(userHandle, "base64url").toString("utf8");
    if (decoded !== cred.userId) {
      console.warn(
        `[auth] userHandle mismatch: credential=${cred.id} expected=${cred.userId}`,
      );
      throw new ApiException(
        "VERIFICATION_FAILED",
        "パスキーの検証に失敗しました。",
      );
    }
  }

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response as unknown as AuthenticationResponseJSON,
      expectedChallenge: challenge.challenge,
      expectedOrigin: env().WEBAUTHN_ORIGIN,
      expectedRPID: env().WEBAUTHN_RP_ID,
      credential: {
        id: cred.id,
        publicKey: new Uint8Array(cred.publicKey),
        counter: cred.counter,
        transports: (cred.transports ?? undefined) as
          | AuthenticatorTransportFuture[]
          | undefined,
      },
      requireUserVerification: false,
    });
  } catch (e) {
    console.warn("[auth] authentication verify failed:", e);
    throw new ApiException(
      "VERIFICATION_FAILED",
      "パスキーの検証に失敗しました。",
    );
  }
  if (!verification.verified) {
    throw new ApiException(
      "VERIFICATION_FAILED",
      "パスキーの検証に失敗しました。",
    );
  }

  // クローン検知（AC-01-4）。プラットフォーム認証器は常に 0 を返すことがあるため、
  // 「保存値 > 0 かつ newCounter <= 保存値」のときだけ拒否する（FR-01 spec §7）
  const newCounter = verification.authenticationInfo.newCounter;
  if (cred.counter > 0 && newCounter <= cred.counter) {
    console.warn(
      `[auth] signature counter regression (clone?): credential=${cred.id} stored=${cred.counter} new=${newCounter}`,
    );
    throw new ApiException(
      "VERIFICATION_FAILED",
      "パスキーの検証に失敗しました。",
    );
  }

  const users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, cred.userId))
    .limit(1);
  const user = users[0];
  if (!user) {
    throw new ApiException("INTERNAL", "ユーザーが見つかりません。");
  }

  const sessionId = await db.transaction(async (tx) => {
    await tx
      .update(schema.passkeyCredentials)
      .set({ counter: newCounter, lastUsedAt: new Date() })
      .where(eq(schema.passkeyCredentials.id, cred.id));
    return createSession(tx, cred.userId, userAgent);
  });
  return {
    user: { id: user.id, displayName: user.displayName },
    sessionId,
  };
}

// ---- パスキー管理（FR-01 spec §3.3 / §3.4） ----

export async function createAddPasskeyOptions(db: Db, user: AuthUser) {
  const existing = await db
    .select({
      id: schema.passkeyCredentials.id,
      transports: schema.passkeyCredentials.transports,
    })
    .from(schema.passkeyCredentials)
    .where(eq(schema.passkeyCredentials.userId, user.id));
  const options = await generateRegistrationOptions({
    rpName: env().WEBAUTHN_RP_NAME,
    rpID: env().WEBAUTHN_RP_ID,
    userID: userIdToHandle(user.id),
    userName: user.displayName,
    userDisplayName: user.displayName,
    attestationType: "none",
    // 同じ authenticator での二重登録を防ぐ
    excludeCredentials: existing.map((c) => ({
      id: c.id,
      transports: (c.transports ?? undefined) as
        | AuthenticatorTransportFuture[]
        | undefined,
    })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "preferred",
    },
  });
  const challengeId = await insertChallenge(db, {
    challenge: options.challenge,
    type: "registration",
    userId: user.id,
    displayName: user.displayName,
  });
  return { challengeId, options };
}

export async function verifyAddPasskey(
  db: Db,
  user: AuthUser,
  input: PasskeyVerifyRequest,
): Promise<PasskeySummary> {
  const challenge = await consumeChallenge(
    db,
    input.challengeId,
    "registration",
  );
  if (challenge.userId !== user.id) {
    throw new ApiException("CHALLENGE_NOT_FOUND", "チャレンジが無効です。");
  }
  const info = await verifyRegistrationOrThrow(
    challenge.challenge,
    input.response,
  );
  const rows = await db
    .insert(schema.passkeyCredentials)
    .values({
      id: info.credential.id,
      userId: user.id,
      publicKey: info.credential.publicKey,
      counter: info.credential.counter,
      transports: info.credential.transports,
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
      aaguid: info.aaguid,
      name: passkeyNameFromAaguid(info.aaguid, info.credentialDeviceType),
    })
    .returning();
  const row = rows[0];
  if (!row) {
    throw new ApiException("INTERNAL", "パスキーの保存に失敗しました。");
  }
  return toPasskeySummary(row);
}

/**
 * 登録済みパスキーの一覧（FR-01 spec §4、GET /auth/passkeys）。
 *
 * 並びは **登録日の昇順（同時刻は id 昇順）** で API が保証する。orderBy が無いと
 * 返却順が Postgres のプラン任せになり、ログインのたびの `counter` / `last_used_at`
 * の UPDATE や名前変更で新タプルが末尾に置かれて、画面の行が飛ぶ（#221）。
 */
export async function listPasskeys(
  db: Db,
  userId: string,
): Promise<PasskeySummary[]> {
  const rows = await db
    .select()
    .from(schema.passkeyCredentials)
    .where(eq(schema.passkeyCredentials.userId, userId))
    .orderBy(
      asc(schema.passkeyCredentials.createdAt),
      asc(schema.passkeyCredentials.id),
    );
  return rows.map(toPasskeySummary);
}

export async function deletePasskey(
  db: Db,
  userId: string,
  credentialId: string,
): Promise<void> {
  const rows = await db
    .select({ id: schema.passkeyCredentials.id })
    .from(schema.passkeyCredentials)
    .where(eq(schema.passkeyCredentials.userId, userId));
  if (!rows.some((r) => r.id === credentialId)) {
    throw new ApiException("NOT_FOUND", "パスキーが見つかりません。");
  }
  if (rows.length <= 1) {
    // 最後の 1 つを消すとログイン手段が無くなる（復旧手段は存在しない）
    throw new ApiException("LAST_PASSKEY", "最後のパスキーは削除できません。");
  }
  await db
    .delete(schema.passkeyCredentials)
    .where(
      and(
        eq(schema.passkeyCredentials.id, credentialId),
        eq(schema.passkeyCredentials.userId, userId),
      ),
    );
}

/**
 * パスキーの表示名を変更する（FR-01 spec §3.4、PATCH /auth/passkeys/:id）。
 * 所有者一致を WHERE に含めて UPDATE し、0 行なら「他人のもの」も「存在しない」も同じ 404 にする
 * （所有の有無を漏らさない）。name は zod（passkeyNameSchema）で trim 済みの値を受け取る。
 */
export async function renamePasskey(
  db: Db,
  userId: string,
  credentialId: string,
  name: string,
): Promise<PasskeySummary> {
  const rows = await db
    .update(schema.passkeyCredentials)
    .set({ name })
    .where(
      and(
        eq(schema.passkeyCredentials.id, credentialId),
        eq(schema.passkeyCredentials.userId, userId),
      ),
    )
    .returning();
  const row = rows[0];
  if (!row) {
    throw new ApiException("NOT_FOUND", "パスキーが見つかりません。");
  }
  return toPasskeySummary(row);
}

function toPasskeySummary(row: {
  id: string;
  name: string | null;
  deviceType: string | null;
  backedUp: boolean | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}): PasskeySummary {
  return {
    id: row.id,
    name: row.name,
    deviceType: row.deviceType,
    backedUp: row.backedUp,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  };
}
