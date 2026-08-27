import { type Db, schema } from "@dopamin/db";
import {
  ERROR_STATUS,
  type ErrorCode,
  type PasskeyVerifyRequest,
} from "@dopamin/shared";
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createTestDb, resetTestDb } from "../../test/helpers/db";
import { ApiException } from "../lib/errors";
import {
  createAddPasskeyOptions,
  createAuthenticationOptions,
  createRegistrationOptions,
  deletePasskey,
  listPasskeys,
  verifyAddPasskey,
  verifyAuthentication,
  verifyRegistration,
} from "./auth";

/**
 * FR-01 services/auth.ts の unit / 契約テスト（docs/specs/passkey-auth.md §9、issue #126）。
 * DB は pglite。SimpleWebAuthn の verify* だけをモックし、generate*Options は本物を使う。
 * ルート経由（HTTP → zod → Cookie）の契約は test/routes/auth.test.ts が持つので、
 * ここではサービス関数を直接呼んで DB 更新と例外を検証する。
 */
vi.mock("@simplewebauthn/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@simplewebauthn/server")>();
  return {
    ...actual,
    verifyRegistrationResponse: vi.fn(),
    verifyAuthenticationResponse: vi.fn(),
  };
});

const ORIGIN = "http://localhost:3000";
const RP_ID = "localhost";

type RegistrationInfo = NonNullable<
  Awaited<ReturnType<typeof verifyRegistrationResponse>>["registrationInfo"]
>;
type VerifiedAuthentication = Awaited<
  ReturnType<typeof verifyAuthenticationResponse>
>;

function fakeRegistrationInfo(
  credentialId: string,
  counter = 0,
): RegistrationInfo {
  return {
    fmt: "none",
    aaguid: "00000000-0000-0000-0000-000000000000",
    credential: {
      id: credentialId,
      publicKey: new Uint8Array([1, 2, 3]),
      counter,
      transports: ["internal"],
    },
    credentialType: "public-key",
    attestationObject: new Uint8Array(),
    userVerified: true,
    credentialDeviceType: "singleDevice",
    credentialBackedUp: false,
    origin: ORIGIN,
    rpID: RP_ID,
  };
}

function fakeVerifiedAuthentication(
  credentialId: string,
  newCounter: number,
): VerifiedAuthentication {
  return {
    verified: true,
    authenticationInfo: {
      credentialID: credentialId,
      newCounter,
      userVerified: true,
      credentialDeviceType: "singleDevice",
      credentialBackedUp: false,
      origin: ORIGIN,
      rpID: RP_ID,
    },
  };
}

/** verify* に渡す入力（packages/shared の passkeyVerifyRequestSchema を満たす最小形） */
function verifyInput(
  challengeId: string,
  credentialId: string,
  responseFields: Record<string, unknown> = {},
): PasskeyVerifyRequest {
  return {
    challengeId,
    response: {
      id: credentialId,
      rawId: credentialId,
      type: "public-key",
      response: { clientDataJSON: "e30", ...responseFields },
    },
  };
}

/** authenticator が返す userHandle（users.id を UTF-8 → base64url。services/auth.ts の userIdToHandle と対） */
function userHandleOf(userId: string): string {
  return Buffer.from(userId, "utf8").toString("base64url");
}

/** ApiException の code と status（ERROR_STATUS）を検証する */
async function expectApiException(
  promise: Promise<unknown>,
  code: ErrorCode,
): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiException);
  const exception = error as ApiException;
  expect(exception.code).toBe(code);
  expect(exception.status).toBe(ERROR_STATUS[code]);
}

async function insertChallengeRow(
  db: Db,
  values: {
    type: "registration" | "authentication";
    userId?: string;
    displayName?: string;
    expiresAt: Date;
    challenge?: string;
  },
): Promise<string> {
  const rows = await db
    .insert(schema.webauthnChallenges)
    .values({ challenge: values.challenge ?? "challenge-value", ...values })
    .returning({ id: schema.webauthnChallenges.id });
  return rows[0]?.id ?? "";
}

/** users + passkey_credentials を 1 行ずつ作る */
async function seedUserWithPasskey(
  db: Db,
  opts: { credentialId: string; counter?: number; displayName?: string },
): Promise<{ userId: string; credentialId: string }> {
  const users = await db
    .insert(schema.users)
    .values({ displayName: opts.displayName ?? "たくたく" })
    .returning({ id: schema.users.id });
  const userId = users[0]?.id ?? "";
  await db.insert(schema.passkeyCredentials).values({
    id: opts.credentialId,
    userId,
    publicKey: new Uint8Array([1, 2, 3]),
    counter: opts.counter ?? 0,
    transports: ["internal"],
    deviceType: "singleDevice",
    backedUp: false,
    name: "このデバイス",
  });
  return { userId, credentialId: opts.credentialId };
}

let db: Db;
let closeDb: (() => Promise<void>) | undefined;

beforeAll(async () => {
  process.env.DATABASE_URL = "postgres://unused:unused@localhost:1/unused";
  process.env.WEBAUTHN_RP_ID = RP_ID;
  process.env.WEBAUTHN_ORIGIN = ORIGIN;
  ({ db, close: closeDb } = await createTestDb());
}, 30_000);

afterAll(async () => {
  // beforeAll が timeout した場合は未代入。ここで TypeError を出すと本来の原因を隠すので省略可能にする
  await closeDb?.();
});

beforeEach(async () => {
  await resetTestDb(db);
  vi.mocked(verifyRegistrationResponse).mockReset();
  vi.mocked(verifyAuthenticationResponse).mockReset();
  // クローン検知などの警告ログでテスト出力を汚さない。呼ばれたことは spy で検証する
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("期限切れチャレンジの掃除（FR-01 spec §7: options 発行時に opportunistic に DELETE）", () => {
  it("createAuthenticationOptions が期限切れ行を消し、有効な行は残す", async () => {
    const expired = await insertChallengeRow(db, {
      type: "authentication",
      expiresAt: new Date(Date.now() - 1_000),
    });
    const valid = await insertChallengeRow(db, {
      type: "registration",
      userId: crypto.randomUUID(),
      displayName: "まだ有効",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const { challengeId } = await createAuthenticationOptions(db);

    const ids = (await db.select().from(schema.webauthnChallenges)).map(
      (r) => r.id,
    );
    expect(ids).not.toContain(expired);
    expect(ids).toContain(valid);
    expect(ids).toContain(challengeId);
  });

  it("createRegistrationOptions / createAddPasskeyOptions も同じく掃除する", async () => {
    const expired = await insertChallengeRow(db, {
      type: "registration",
      expiresAt: new Date(Date.now() - 1_000),
    });
    await createRegistrationOptions(db, "新規");
    expect(
      (await db.select().from(schema.webauthnChallenges)).map((r) => r.id),
    ).not.toContain(expired);

    const expired2 = await insertChallengeRow(db, {
      type: "registration",
      expiresAt: new Date(Date.now() - 1_000),
    });
    const { userId } = await seedUserWithPasskey(db, { credentialId: "c-1" });
    await createAddPasskeyOptions(db, { id: userId, displayName: "たくたく" });
    expect(
      (await db.select().from(schema.webauthnChallenges)).map((r) => r.id),
    ).not.toContain(expired2);
  });
});

describe("verifyRegistration（サインアップ。FR-01 spec §3.1）", () => {
  // HTTP 経由の契約（応答ボディ・Set-Cookie・Origin / RP ID の受け渡し）は
  // test/routes/auth.test.ts が持つ。ここではサービスの戻り値と DB 行の対応だけを見る
  it("成功で users / passkey_credentials / sessions が 1 行ずつ作られ、sessionId と userAgent が sessions に入り、challenge が削除される", async () => {
    const { challengeId } = await createRegistrationOptions(db, "たくたく");
    vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({
      verified: true,
      registrationInfo: fakeRegistrationInfo("cred-signup"),
    });

    const { user, sessionId } = await verifyRegistration(
      db,
      verifyInput(challengeId, "cred-signup"),
      "vitest-ua",
    );

    expect(user.displayName).toBe("たくたく");
    expect(await db.$count(schema.users)).toBe(1);
    const creds = await db.select().from(schema.passkeyCredentials);
    expect(creds).toHaveLength(1);
    expect(creds[0]).toMatchObject({
      id: "cred-signup",
      userId: user.id,
      counter: 0,
      name: "このデバイス",
    });
    const sessions = await db.select().from(schema.sessions);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: sessionId,
      userId: user.id,
      userAgent: "vitest-ua",
    });
    expect(await db.$count(schema.webauthnChallenges)).toBe(0);
  });

  it("期限切れ challenge は 400 CHALLENGE_NOT_FOUND（行は消費され、users は作られない）", async () => {
    const challengeId = await insertChallengeRow(db, {
      type: "registration",
      userId: crypto.randomUUID(),
      displayName: "期限切れ",
      expiresAt: new Date(Date.now() - 1_000),
    });

    await expectApiException(
      verifyRegistration(db, verifyInput(challengeId, "cred-x")),
      "CHALLENGE_NOT_FOUND",
    );
    expect(vi.mocked(verifyRegistrationResponse)).not.toHaveBeenCalled();
    expect(await db.$count(schema.webauthnChallenges)).toBe(0);
    expect(await db.$count(schema.users)).toBe(0);
  });

  it("使用済み challenge の再利用は 400 CHALLENGE_NOT_FOUND", async () => {
    const { challengeId } = await createRegistrationOptions(db, "一度きり");
    vi.mocked(verifyRegistrationResponse).mockResolvedValue({
      verified: true,
      registrationInfo: fakeRegistrationInfo("cred-once"),
    });
    await verifyRegistration(db, verifyInput(challengeId, "cred-once"));

    await expectApiException(
      verifyRegistration(db, verifyInput(challengeId, "cred-twice")),
      "CHALLENGE_NOT_FOUND",
    );
    expect(await db.$count(schema.users)).toBe(1);
  });

  it("存在しない challengeId は 400 CHALLENGE_NOT_FOUND", async () => {
    await expectApiException(
      verifyRegistration(db, verifyInput(crypto.randomUUID(), "cred-x")),
      "CHALLENGE_NOT_FOUND",
    );
  });

  it("attestation 検証失敗（verified: false）は 401 VERIFICATION_FAILED で、challenge は消費済み・users 無し", async () => {
    const { challengeId } = await createRegistrationOptions(db, "失敗");
    vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({
      verified: false,
    });

    await expectApiException(
      verifyRegistration(db, verifyInput(challengeId, "cred-bad")),
      "VERIFICATION_FAILED",
    );
    expect(await db.$count(schema.webauthnChallenges)).toBe(0);
    expect(await db.$count(schema.users)).toBe(0);
  });

  it("SimpleWebAuthn が throw した場合も 401 VERIFICATION_FAILED", async () => {
    const { challengeId } = await createRegistrationOptions(db, "例外");
    vi.mocked(verifyRegistrationResponse).mockRejectedValueOnce(
      new Error("Unexpected registration response origin"),
    );
    await expectApiException(
      verifyRegistration(db, verifyInput(challengeId, "cred-throw")),
      "VERIFICATION_FAILED",
    );
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("verifyAuthentication（ログイン。FR-01 spec §3.2 / AC-01-4）", () => {
  it("成功で counter / last_used_at が更新され sessions が 1 行できる（両方 0 は正常）", async () => {
    const { userId } = await seedUserWithPasskey(db, {
      credentialId: "cred-login",
      counter: 0,
    });
    const { challengeId, options } = await createAuthenticationOptions(db);
    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce(
      fakeVerifiedAuthentication("cred-login", 0),
    );

    const { user, sessionId } = await verifyAuthentication(
      db,
      verifyInput(challengeId, "cred-login"),
    );

    expect(user.id).toBe(userId);
    expect(vi.mocked(verifyAuthenticationResponse)).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: options.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        credential: expect.objectContaining({ id: "cred-login", counter: 0 }),
        requireUserVerification: false,
      }),
    );
    const cred = (await db.select().from(schema.passkeyCredentials))[0];
    expect(cred?.lastUsedAt).toBeInstanceOf(Date);
    const sessions = await db.select().from(schema.sessions);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: sessionId, userId });
    expect(await db.$count(schema.webauthnChallenges)).toBe(0);
  });

  it("counter が進んでいれば保存値を更新する（10 → 11）", async () => {
    await seedUserWithPasskey(db, { credentialId: "cred-up", counter: 10 });
    const { challengeId } = await createAuthenticationOptions(db);
    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce(
      fakeVerifiedAuthentication("cred-up", 11),
    );

    await verifyAuthentication(db, verifyInput(challengeId, "cred-up"));

    const cred = (
      await db
        .select()
        .from(schema.passkeyCredentials)
        .where(eq(schema.passkeyCredentials.id, "cred-up"))
    )[0];
    expect(cred?.counter).toBe(11);
  });

  it("signature counter の後退（保存 10、new 10）は 401 VERIFICATION_FAILED + console.warn、counter は据え置き、sessions 無し（AC-01-4）", async () => {
    await seedUserWithPasskey(db, { credentialId: "cred-clone", counter: 10 });
    const { challengeId } = await createAuthenticationOptions(db);
    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce(
      fakeVerifiedAuthentication("cred-clone", 10),
    );

    await expectApiException(
      verifyAuthentication(db, verifyInput(challengeId, "cred-clone")),
      "VERIFICATION_FAILED",
    );

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("signature counter regression"),
    );
    const cred = (await db.select().from(schema.passkeyCredentials))[0];
    expect(cred?.counter).toBe(10);
    expect(cred?.lastUsedAt).toBeNull();
    expect(await db.$count(schema.sessions)).toBe(0);
    // challenge は失敗時も消費される（再利用させない）
    expect(await db.$count(schema.webauthnChallenges)).toBe(0);
  });

  it("userHandle が credential の user_id と一致しなければ 401 VERIFICATION_FAILED（SimpleWebAuthn は呼ばれない）", async () => {
    await seedUserWithPasskey(db, { credentialId: "cred-handle" });
    const { challengeId } = await createAuthenticationOptions(db);

    await expectApiException(
      verifyAuthentication(
        db,
        verifyInput(challengeId, "cred-handle", {
          userHandle: userHandleOf(crypto.randomUUID()),
        }),
      ),
      "VERIFICATION_FAILED",
    );

    expect(vi.mocked(verifyAuthenticationResponse)).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("userHandle mismatch"),
    );
    expect(await db.$count(schema.sessions)).toBe(0);
  });

  it("userHandle が一致すれば通る", async () => {
    const { userId } = await seedUserWithPasskey(db, {
      credentialId: "cred-handle-ok",
    });
    const { challengeId } = await createAuthenticationOptions(db);
    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce(
      fakeVerifiedAuthentication("cred-handle-ok", 0),
    );

    const { user } = await verifyAuthentication(
      db,
      verifyInput(challengeId, "cred-handle-ok", {
        userHandle: userHandleOf(userId),
      }),
    );
    expect(user.id).toBe(userId);
  });

  it("未登録の credential ID は 401 CREDENTIAL_NOT_FOUND", async () => {
    const { challengeId } = await createAuthenticationOptions(db);
    await expectApiException(
      verifyAuthentication(db, verifyInput(challengeId, "cred-unknown")),
      "CREDENTIAL_NOT_FOUND",
    );
    expect(vi.mocked(verifyAuthenticationResponse)).not.toHaveBeenCalled();
  });

  it("registration 用 challenge をログインに使うと 400 CHALLENGE_NOT_FOUND（type 不一致）", async () => {
    await seedUserWithPasskey(db, { credentialId: "cred-type" });
    const { challengeId } = await createRegistrationOptions(db, "誰か");
    await expectApiException(
      verifyAuthentication(db, verifyInput(challengeId, "cred-type")),
      "CHALLENGE_NOT_FOUND",
    );
  });

  it("assertion 検証失敗（verified: false）は 401 VERIFICATION_FAILED", async () => {
    await seedUserWithPasskey(db, { credentialId: "cred-nv" });
    const { challengeId } = await createAuthenticationOptions(db);
    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({
      ...fakeVerifiedAuthentication("cred-nv", 0),
      verified: false,
    });
    await expectApiException(
      verifyAuthentication(db, verifyInput(challengeId, "cred-nv")),
      "VERIFICATION_FAILED",
    );
    expect(await db.$count(schema.sessions)).toBe(0);
  });
});

describe("verifyAddPasskey（追加登録。FR-01 spec §3.3）", () => {
  it("他人の challenge は 400 CHALLENGE_NOT_FOUND", async () => {
    const { userId } = await seedUserWithPasskey(db, { credentialId: "c-a" });
    const other = await seedUserWithPasskey(db, {
      credentialId: "c-b",
      displayName: "他人",
    });
    const { challengeId } = await createAddPasskeyOptions(db, {
      id: other.userId,
      displayName: "他人",
    });

    await expectApiException(
      verifyAddPasskey(
        db,
        { id: userId, displayName: "たくたく" },
        verifyInput(challengeId, "c-new"),
      ),
      "CHALLENGE_NOT_FOUND",
    );
    expect(vi.mocked(verifyRegistrationResponse)).not.toHaveBeenCalled();
  });

  it("成功で passkey_credentials だけが増える（users / sessions は増えない）", async () => {
    const { userId } = await seedUserWithPasskey(db, { credentialId: "c-1" });
    const user = { id: userId, displayName: "たくたく" };
    const { challengeId, options } = await createAddPasskeyOptions(db, user);
    // excludeCredentials に既存 credential が入る
    expect(options.excludeCredentials?.map((c) => c.id)).toEqual(["c-1"]);
    vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({
      verified: true,
      registrationInfo: fakeRegistrationInfo("c-2"),
    });

    const passkey = await verifyAddPasskey(
      db,
      user,
      verifyInput(challengeId, "c-2"),
    );

    expect(passkey.id).toBe("c-2");
    expect(await db.$count(schema.passkeyCredentials)).toBe(2);
    expect(await db.$count(schema.users)).toBe(1);
    expect(await db.$count(schema.sessions)).toBe(0);
  });
});

describe("deletePasskey（FR-01 spec §3.4）", () => {
  it("最後の 1 件は 409 LAST_PASSKEY で、行は残る", async () => {
    const { userId } = await seedUserWithPasskey(db, { credentialId: "only" });
    await expectApiException(deletePasskey(db, userId, "only"), "LAST_PASSKEY");
    expect(await db.$count(schema.passkeyCredentials)).toBe(1);
  });

  it("他人のパスキーは 404 NOT_FOUND（存在は漏らさない）", async () => {
    const me = await seedUserWithPasskey(db, { credentialId: "mine" });
    await seedUserWithPasskey(db, {
      credentialId: "theirs",
      displayName: "他人",
    });
    await expectApiException(
      deletePasskey(db, me.userId, "theirs"),
      "NOT_FOUND",
    );
    expect(await db.$count(schema.passkeyCredentials)).toBe(2);
  });

  it("存在しない ID も 404 NOT_FOUND", async () => {
    const { userId } = await seedUserWithPasskey(db, { credentialId: "a" });
    await expectApiException(deletePasskey(db, userId, "ghost"), "NOT_FOUND");
  });

  it("2 件あれば 1 件削除でき、残りは 1 件", async () => {
    const { userId } = await seedUserWithPasskey(db, { credentialId: "k-1" });
    await db.insert(schema.passkeyCredentials).values({
      id: "k-2",
      userId,
      publicKey: new Uint8Array([9]),
      counter: 0,
    });

    await deletePasskey(db, userId, "k-1");

    const rest = await db.select().from(schema.passkeyCredentials);
    expect(rest.map((r) => r.id)).toEqual(["k-2"]);
  });
});

/**
 * #221: 一覧の並び順は API が保証する（作成日昇順、同時刻は id 昇順）。
 * orderBy が無いと返却順が Postgres のプラン任せになり、ログインや名前変更で
 * UPDATE された行が Seq Scan の末尾へ移動して画面の行が飛ぶ。
 */
describe("listPasskeys の並び順（#221 / FR-01 spec §4）", () => {
  it("物理順ではなく created_at 昇順で返す", async () => {
    const { userId } = await seedUserWithPasskey(db, { credentialId: "old" });
    // 物理順（挿入順）と created_at の順をわざとずらす
    await db
      .update(schema.passkeyCredentials)
      .set({ createdAt: new Date("2026-08-01T00:00:00.000Z") })
      .where(eq(schema.passkeyCredentials.id, "old"));
    await db.insert(schema.passkeyCredentials).values([
      {
        id: "newest",
        userId,
        publicKey: new Uint8Array([2]),
        counter: 0,
        createdAt: new Date("2026-08-03T00:00:00.000Z"),
      },
      {
        id: "middle",
        userId,
        publicKey: new Uint8Array([3]),
        counter: 0,
        createdAt: new Date("2026-08-02T00:00:00.000Z"),
      },
    ]);

    const list = await listPasskeys(db, userId);

    expect(list.map((p) => p.id)).toEqual(["old", "middle", "newest"]);
  });

  it("created_at が同時刻なら id 昇順で安定させる", async () => {
    const createdAt = new Date("2026-08-01T00:00:00.000Z");
    const { userId } = await seedUserWithPasskey(db, { credentialId: "b" });
    await db
      .update(schema.passkeyCredentials)
      .set({ createdAt })
      .where(eq(schema.passkeyCredentials.id, "b"));
    await db.insert(schema.passkeyCredentials).values([
      {
        id: "c",
        userId,
        publicKey: new Uint8Array([2]),
        counter: 0,
        createdAt,
      },
      {
        id: "a",
        userId,
        publicKey: new Uint8Array([3]),
        counter: 0,
        createdAt,
      },
    ]);

    expect((await listPasskeys(db, userId)).map((p) => p.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("行を更新しても並びは変わらない（ログイン・名前変更で行が飛ばない）", async () => {
    const { userId } = await seedUserWithPasskey(db, { credentialId: "a" });
    await db.insert(schema.passkeyCredentials).values([
      { id: "b", userId, publicKey: new Uint8Array([2]), counter: 0 },
      { id: "c", userId, publicKey: new Uint8Array([3]), counter: 0 },
    ]);
    const before = (await listPasskeys(db, userId)).map((p) => p.id);
    // 統計が無いと索引経由のプランになり症状が出ないので、本番と同じ Seq Scan を選ばせる
    await db.execute(sql`ANALYZE "passkey_credentials"`);

    // ログイン相当（counter / last_used_at の UPDATE）と名前変更相当
    await db
      .update(schema.passkeyCredentials)
      .set({ counter: 1, lastUsedAt: new Date() })
      .where(eq(schema.passkeyCredentials.id, "a"));
    await db
      .update(schema.passkeyCredentials)
      .set({ name: "改名した" })
      .where(eq(schema.passkeyCredentials.id, "b"));

    expect((await listPasskeys(db, userId)).map((p) => p.id)).toEqual(before);
  });
});
