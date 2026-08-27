import { type Db, schema } from "@dopamin/db";
import { authUserSchema, passkeySummarySchema } from "@dopamin/shared";
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { z } from "zod";
import app from "../../src/index";
import { setDbForTesting } from "../../src/lib/db";
import { createTestDb, resetTestDb } from "../helpers/db";
import { createTestSession } from "../helpers/session";

// API 応答は as キャストではなく zod で形を検証してから使う（CLAUDE.md）
const optionsResponseSchema = z.object({
  challengeId: z.uuid(),
  options: z.object({ challenge: z.string().min(1) }),
});
const verifyResponseSchema = z.object({ user: authUserSchema });

/**
 * FR-01 契約テスト（docs/specs/passkey-auth.md §9）。
 * SimpleWebAuthn の verify* はモックし、API ルートが DB を正しく更新することを検証する。
 * generate*Options は本物を使う（純粋関数で外部通信なし）。
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

type RegistrationInfo = NonNullable<
  Awaited<ReturnType<typeof verifyRegistrationResponse>>["registrationInfo"]
>;
type VerifiedAuthentication = Awaited<
  ReturnType<typeof verifyAuthenticationResponse>
>;

/** verifyRegistrationResponse が返す registrationInfo の最小ダミー */
function fakeRegistrationInfo(credentialId: string): RegistrationInfo {
  return {
    fmt: "none",
    aaguid: "00000000-0000-0000-0000-000000000000",
    credential: {
      id: credentialId,
      publicKey: new Uint8Array([1, 2, 3]),
      counter: 0,
      transports: ["internal"],
    },
    credentialType: "public-key",
    attestationObject: new Uint8Array(),
    userVerified: true,
    credentialDeviceType: "singleDevice",
    credentialBackedUp: false,
    origin: "http://localhost:3000",
    rpID: "localhost",
  };
}

/** ブラウザから返る形（packages/shared の webauthnResponseSchema を満たす最小形） */
function fakeWebauthnResponse(credentialId: string) {
  return {
    id: credentialId,
    rawId: credentialId,
    type: "public-key",
    response: { clientDataJSON: "e30", attestationObject: "e30" },
  };
}

function fakeAuthenticationResponse(credentialId: string) {
  return {
    id: credentialId,
    rawId: credentialId,
    type: "public-key",
    response: {
      clientDataJSON: "e30",
      authenticatorData: "e30",
      signature: "e30",
    },
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
      origin: "http://localhost:3000",
      rpID: "localhost",
    },
  };
}

async function insertCredential(userId: string, id: string, counter = 0) {
  await db.insert(schema.passkeyCredentials).values({
    id,
    userId,
    publicKey: Buffer.from([1, 2, 3]),
    counter,
    deviceType: "singleDevice",
    backedUp: false,
    name: "このデバイス",
  });
}

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

let db: Db;
let closeDb: (() => Promise<void>) | undefined;

beforeAll(async () => {
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

beforeEach(async () => {
  await resetTestDb(db);
  vi.mocked(verifyRegistrationResponse).mockReset();
  vi.mocked(verifyAuthenticationResponse).mockReset();
});

describe("POST /auth/passkey/register/{options,verify}（FR-01 spec §3.1 サインアップ契約）", () => {
  it("verify 成功で users / passkey_credentials / sessions が 1 行ずつ作られ、challenge が削除される", async () => {
    const optionsRes = await app.request(
      "/api/v1/auth/passkey/register/options",
      json({ displayName: "たくたく" }),
    );
    expect(optionsRes.status).toBe(200);
    const { challengeId, options } = optionsResponseSchema.parse(
      await optionsRes.json(),
    );
    // options 発行時点では users はまだ作られず、challenge だけが保存される
    expect(await db.$count(schema.users)).toBe(0);
    expect(await db.$count(schema.webauthnChallenges)).toBe(1);

    vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({
      verified: true,
      registrationInfo: fakeRegistrationInfo("cred-signup"),
    });

    const verifyRes = await app.request(
      "/api/v1/auth/passkey/register/verify",
      json({ challengeId, response: fakeWebauthnResponse("cred-signup") }),
    );
    expect(verifyRes.status).toBe(200);
    const body = verifyResponseSchema.parse(await verifyRes.json());
    expect(body.user.displayName).toBe("たくたく");

    // SimpleWebAuthn には保存した challenge と環境変数の Origin / RP ID が渡る（spec §5）
    expect(vi.mocked(verifyRegistrationResponse)).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: options.challenge,
        expectedOrigin: "http://localhost:3000",
        expectedRPID: "localhost",
        requireUserVerification: false,
      }),
    );

    // DB: users / passkey_credentials / sessions が 1 行ずつ、challenge は削除
    const users = await db.select().from(schema.users);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      id: body.user.id,
      displayName: "たくたく",
    });

    const credentials = await db.select().from(schema.passkeyCredentials);
    expect(credentials).toHaveLength(1);
    expect(credentials[0]).toMatchObject({
      id: "cred-signup",
      userId: body.user.id,
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      name: "このデバイス",
    });
    expect(Array.from(credentials[0]?.publicKey ?? [])).toEqual([1, 2, 3]);

    const sessions = await db.select().from(schema.sessions);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.userId).toBe(body.user.id);

    expect(await db.$count(schema.webauthnChallenges)).toBe(0);

    // Set-Cookie の値が sessions.id と一致する（§12.3: Cookie 値 = sessions.id）
    const setCookie = verifyRes.headers.get("set-cookie") ?? "";
    const match = /^dopamin_session=([^;]+)/.exec(setCookie);
    expect(match?.[1]).toBe(sessions[0]?.id);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
  });
});

describe("POST /auth/passkey/login/{options,verify}（FR-01 spec §3.2 ログイン契約）", () => {
  it("verify 成功で credential を更新し、API 応答と Set-Cookie に新規 session を返す", async () => {
    const loginUser = await createTestSession(db, {
      displayName: "ログインユーザー",
    });
    await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.id, loginUser.sessionId));
    await insertCredential(loginUser.user.id, "cred-login", 4);

    const optionsRes = await app.request(
      "/api/v1/auth/passkey/login/options",
      json({}),
    );
    expect(optionsRes.status).toBe(200);
    const { challengeId, options } = optionsResponseSchema.parse(
      await optionsRes.json(),
    );
    expect(await db.$count(schema.webauthnChallenges)).toBe(1);

    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce(
      fakeVerifiedAuthentication("cred-login", 5),
    );
    const verifyRes = await app.request(
      "/api/v1/auth/passkey/login/verify",
      json({
        challengeId,
        response: fakeAuthenticationResponse("cred-login"),
      }),
    );

    expect(verifyRes.status).toBe(200);
    const body = verifyResponseSchema.parse(await verifyRes.json());
    expect(body.user).toMatchObject(loginUser.user);
    expect(vi.mocked(verifyAuthenticationResponse)).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: options.challenge,
        expectedOrigin: "http://localhost:3000",
        expectedRPID: "localhost",
        credential: expect.objectContaining({
          id: "cred-login",
          counter: 4,
        }),
        requireUserVerification: false,
      }),
    );

    const credential = (
      await db
        .select()
        .from(schema.passkeyCredentials)
        .where(eq(schema.passkeyCredentials.id, "cred-login"))
    )[0];
    expect(credential).toMatchObject({ counter: 5 });
    expect(credential?.lastUsedAt).toBeInstanceOf(Date);
    expect(await db.$count(schema.webauthnChallenges)).toBe(0);

    const sessions = await db.select().from(schema.sessions);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.userId).toBe(loginUser.user.id);
    const setCookie = verifyRes.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(
      new RegExp(`^dopamin_session=${sessions[0]?.id};`),
    );
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
  });
});

describe("POST /auth/logout（FR-01 spec §3.2 セッション終了契約）", () => {
  it("認証済み session を削除して Cookie を失効させる", async () => {
    const session = await createTestSession(db);
    const res = await app.request("/api/v1/auth/logout", {
      method: "POST",
      headers: { cookie: session.cookie },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await db.$count(schema.sessions)).toBe(0);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("dopamin_session=");
    expect(setCookie).toContain("Max-Age=0");
  });
});

describe("POST /auth/passkeys/register/{options,verify}（FR-01 spec §3.3 追加登録契約）", () => {
  it("認証ユーザーに 2 本目のパスキーを追加し、既存 credential を除外候補にする", async () => {
    const session = await createTestSession(db, {
      displayName: "追加ユーザー",
    });
    await insertCredential(session.user.id, "cred-existing");

    const optionsRes = await app.request(
      "/api/v1/auth/passkeys/register/options",
      { method: "POST", headers: { cookie: session.cookie } },
    );
    expect(optionsRes.status).toBe(200);
    const { challengeId, options } = optionsResponseSchema
      .extend({
        options: optionsResponseSchema.shape.options.extend({
          excludeCredentials: z.array(z.object({ id: z.string() })).optional(),
        }),
      })
      .parse(await optionsRes.json());
    expect(options.excludeCredentials?.map(({ id }) => id)).toEqual([
      "cred-existing",
    ]);

    vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({
      verified: true,
      registrationInfo: fakeRegistrationInfo("cred-added"),
    });
    const verifyRes = await app.request(
      "/api/v1/auth/passkeys/register/verify",
      json(
        { challengeId, response: fakeWebauthnResponse("cred-added") },
        { cookie: session.cookie },
      ),
    );

    expect(verifyRes.status).toBe(200);
    const responseBody = z
      .object({ passkey: passkeySummarySchema })
      .parse(await verifyRes.json());
    expect(responseBody.passkey).toMatchObject({
      id: "cred-added",
      name: "このデバイス",
    });
    expect(await db.$count(schema.users)).toBe(1);
    expect(await db.$count(schema.sessions)).toBe(1);
    expect(await db.$count(schema.passkeyCredentials)).toBe(2);
    expect(await db.$count(schema.webauthnChallenges)).toBe(0);
  });
});

describe("DELETE /auth/passkeys/:id（FR-01 spec §3.4 削除契約）", () => {
  it("2 本ある自分のパスキーのうち指定した 1 本を削除する", async () => {
    const session = await createTestSession(db);
    await insertCredential(session.user.id, "cred-delete");
    await insertCredential(session.user.id, "cred-keep");

    const res = await app.request("/api/v1/auth/passkeys/cred-delete", {
      method: "DELETE",
      headers: { cookie: session.cookie },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const credentials = await db
      .select({ id: schema.passkeyCredentials.id })
      .from(schema.passkeyCredentials);
    expect(credentials).toEqual([{ id: "cred-keep" }]);
  });
});
