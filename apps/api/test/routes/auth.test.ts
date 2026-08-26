import { type Db, schema } from "@dopamin/db";
import { authUserSchema } from "@dopamin/shared";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
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

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

let db: Db;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  process.env.DATABASE_URL = "postgres://unused:unused@localhost:1/unused";
  process.env.WEBAUTHN_RP_ID = "localhost";
  process.env.WEBAUTHN_ORIGIN = "http://localhost:3000";
  ({ db, close: closeDb } = await createTestDb());
  setDbForTesting(db);
}, 30_000);

afterAll(async () => {
  setDbForTesting(null);
  await closeDb();
});

beforeEach(async () => {
  await resetTestDb(db);
  vi.mocked(verifyRegistrationResponse).mockReset();
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
