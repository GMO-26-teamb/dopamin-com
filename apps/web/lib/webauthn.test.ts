import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, fetchPasskeys, renamePasskeyById } from "./webauthn";

/** fetch を差し替えて、request() の応答検証と ApiRequestError への変換だけを見る */
function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as unknown as Response),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const PASSKEY = {
  id: "pk_1",
  name: "MacBook",
  deviceType: "multiDevice",
  backedUp: true,
  createdAt: "2026-08-25T10:00:00.000Z",
  lastUsedAt: null,
};

describe("renamePasskeyById", () => {
  it("PATCH /api/v1/auth/passkeys/:id に { name } を送り、検証済みの passkey を返す", async () => {
    const fetchMock = stubFetch(200, {
      passkey: { ...PASSKEY, name: "仕事用" },
    });

    await expect(renamePasskeyById("pk/1", "仕事用")).resolves.toEqual({
      ...PASSKEY,
      name: "仕事用",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/passkeys/pk%2F1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "仕事用" }),
    });
  });

  it("統一エラー形式（§10.3）は code 付きの ApiRequestError にする", async () => {
    stubFetch(404, {
      error: { code: "NOT_FOUND", message: "パスキーが見つかりません。" },
    });

    const error = await renamePasskeyById("pk_1", "x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).code).toBe("NOT_FOUND");
    expect((error as ApiRequestError).message).toBe(
      "パスキーが見つかりません。",
    );
  });
});

describe("request の応答検証（外部入力は zod で検証する）", () => {
  it("200 でも形が違えば INTERNAL の ApiRequestError にする", async () => {
    stubFetch(200, { passkeys: [{ id: 1 }] });

    const error = await fetchPasskeys().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).code).toBe("INTERNAL");
  });

  it("形が合えばそのまま返す", async () => {
    stubFetch(200, { passkeys: [PASSKEY] });

    await expect(fetchPasskeys()).resolves.toEqual([PASSKEY]);
  });
});
