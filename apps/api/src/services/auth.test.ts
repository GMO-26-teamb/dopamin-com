import { type Db, schema } from "@dopamin/db";
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
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
import {
  createAddPasskeyOptions,
  createAuthenticationOptions,
  createRegistrationOptions,
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
let closeDb: () => Promise<void>;

beforeAll(async () => {
  process.env.DATABASE_URL = "postgres://unused:unused@localhost:1/unused";
  process.env.WEBAUTHN_RP_ID = RP_ID;
  process.env.WEBAUTHN_ORIGIN = ORIGIN;
  ({ db, close: closeDb } = await createTestDb());
}, 30_000);

afterAll(async () => {
  await closeDb();
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
