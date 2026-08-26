import { beforeAll, describe, expect, it } from "vitest";
import app from "../index";

// DB に触らない範囲（ミドルウェア・zod 検証・統一エラー形式）を検証する。
// SimpleWebAuthn の verify と DB 更新を含む契約テストは FR-01 spec §9 の残課題。
beforeAll(() => {
  process.env.DATABASE_URL = "postgres://unused:unused@localhost:1/unused";
  process.env.WEBAUTHN_RP_ID = "localhost";
  process.env.WEBAUTHN_ORIGIN = "http://localhost:3000";
});

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

describe("originCheck (§10.2)", () => {
  it("rejects a mutating request whose Origin differs from WEBAUTHN_ORIGIN with 403 FORBIDDEN", async () => {
    const res = await app.request(
      "/api/v1/auth/passkey/register/options",
      json({ displayName: "たくたく" }, { origin: "https://evil.example" }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("lets a request with the matching Origin through to validation", async () => {
    const res = await app.request(
      "/api/v1/auth/passkey/register/options",
      json({}, { origin: "http://localhost:3000" }),
    );
    // Origin は通過し、zod 検証で 400 になる
    expect(res.status).toBe(400);
  });

  it("does not check Origin on GET", async () => {
    const res = await app.request("/api/v1/health", {
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(200);
  });
});

describe("zod validation → VALIDATION_ERROR (§10.3)", () => {
  it("rejects displayName longer than 32 chars with details.issues", async () => {
    const res = await app.request(
      "/api/v1/auth/passkey/register/options",
      json({ displayName: "あ".repeat(33) }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; details?: { issues?: unknown } };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(body.error.details?.issues)).toBe(true);
  });

  it("rejects a verify request without a UUID challengeId", async () => {
    const res = await app.request(
      "/api/v1/auth/passkey/login/verify",
      json({
        challengeId: "nope",
        response: { id: "a", rawId: "a", type: "public-key", response: {} },
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });
});

describe("requireSession (AC-01-3)", () => {
  it.each([
    ["GET", "/api/v1/auth/me"],
    ["GET", "/api/v1/auth/passkeys"],
    ["POST", "/api/v1/auth/logout"],
    ["POST", "/api/v1/auth/passkeys/register/options"],
    ["DELETE", "/api/v1/auth/passkeys/some-id"],
    ["PATCH", "/api/v1/auth/passkeys/some-id"],
    ["PATCH", "/api/v1/settings/ai"],
  ])(
    "%s %s returns 401 UNAUTHORIZED without a session cookie",
    async (method, path) => {
      const res = await app.request(path, { method });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({
        error: { code: "UNAUTHORIZED" },
      });
    },
  );
});

describe("requestId (§10.2 / §10.3)", () => {
  it("issues an x-request-id and echoes it in the error body", async () => {
    const res = await app.request("/api/v1/auth/me");
    const id = res.headers.get("x-request-id");
    expect(id).toMatch(/^req_[0-9a-f-]{36}$/);
    const body = (await res.json()) as { error: { requestId?: string } };
    expect(body.error.requestId).toBe(id);
  });

  it("keeps a well-formed incoming x-request-id", async () => {
    const res = await app.request("/api/v1/health", {
      headers: { "x-request-id": "trace-abc_123" },
    });
    expect(res.headers.get("x-request-id")).toBe("trace-abc_123");
  });

  it("replaces a malformed incoming x-request-id", async () => {
    const res = await app.request("/api/v1/health", {
      headers: { "x-request-id": "bad id with spaces & symbols!" },
    });
    expect(res.headers.get("x-request-id")).toMatch(/^req_/);
  });
});
