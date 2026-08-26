import { describe, expect, it } from "vitest";
import { MASKED_VALUE, maskSensitiveValues } from "./masking";

describe("maskSensitiveValues（AC-15-2）", () => {
  it("authInfo / apiKey / password 系のキーを *** に置換する", () => {
    const masked = maskSensitiveValues({
      domain: "example.com",
      authInfo: "secret-auth",
      apiKey: "key-123",
      gatePassword: "gate-pass",
      Authorization: "Basic abc",
    });
    expect(masked).toEqual({
      domain: "example.com",
      authInfo: MASKED_VALUE,
      apiKey: MASKED_VALUE,
      gatePassword: MASKED_VALUE,
      Authorization: MASKED_VALUE,
    });
  });

  it("区切り文字・大文字小文字の揺れ（auth_info / AUTHCODE / api-key）も対象にする", () => {
    expect(
      maskSensitiveValues({ auth_info: "a", AUTHCODE: "b", "api-key": "c" }),
    ).toEqual({
      auth_info: MASKED_VALUE,
      AUTHCODE: MASKED_VALUE,
      "api-key": MASKED_VALUE,
    });
  });

  it("接頭辞・接尾辞付きのキー（x-api-key / accessToken / clientSecret など）も部分一致で対象にする", () => {
    expect(
      maskSensitiveValues({
        "x-api-key": "a",
        X_API_KEY: "b",
        accessToken: "c",
        refresh_token: "d",
        clientSecret: "e",
        apiSecret: "f",
        gatePassword: "g",
        passwd: "h",
      }),
    ).toEqual({
      "x-api-key": MASKED_VALUE,
      X_API_KEY: MASKED_VALUE,
      accessToken: MASKED_VALUE,
      refresh_token: MASKED_VALUE,
      clientSecret: MASKED_VALUE,
      apiSecret: MASKED_VALUE,
      gatePassword: MASKED_VALUE,
      passwd: MASKED_VALUE,
    });
  });

  it("EPP authInfo の pw 要素は完全一致で対象にする（pwd 等の無関係なキーは残す）", () => {
    expect(
      maskSensitiveValues({ pw: "x", PW: "y", pwd: "keep", spw: "keep" }),
    ).toEqual({ pw: MASKED_VALUE, PW: MASKED_VALUE, pwd: "keep", spw: "keep" });
  });

  it("機密語彙を含まない通常のキー（name / status / clTRID など）はマスクしない", () => {
    const input = {
      name: "example.com",
      status: "ok",
      clTRID: "req-1",
      svTRID: "sv-1",
      registrant: "c1",
    };
    expect(maskSensitiveValues(input)).toEqual(input);
  });

  it("ネストしたオブジェクト・配列の中もマスクする", () => {
    const masked = maskSensitiveValues({
      body: {
        contacts: [{ id: "c1", authInfo: "deep-secret" }],
      },
    });
    expect(masked).toEqual({
      body: {
        contacts: [{ id: "c1", authInfo: MASKED_VALUE }],
      },
    });
  });

  it("機密キーの値がオブジェクトでも丸ごと *** にする", () => {
    expect(maskSensitiveValues({ authInfo: { pw: "x" } })).toEqual({
      authInfo: MASKED_VALUE,
    });
  });

  it("入力オブジェクトを変更しない", () => {
    const input = { authInfo: "raw" };
    maskSensitiveValues(input);
    expect(input.authInfo).toBe("raw");
  });

  it("プリミティブ・null はそのまま返す", () => {
    expect(maskSensitiveValues("plain")).toBe("plain");
    expect(maskSensitiveValues(42)).toBe(42);
    expect(maskSensitiveValues(null)).toBeNull();
    expect(maskSensitiveValues(undefined)).toBeUndefined();
  });

  it("深さ上限を超えたネストは *** に落とす（暴走防御）", () => {
    let value: unknown = "leaf";
    for (let i = 0; i < 40; i += 1) {
      value = { nested: value };
    }
    const masked = JSON.stringify(maskSensitiveValues(value));
    expect(masked).toContain(`"${MASKED_VALUE}"`);
    expect(masked).not.toContain("leaf");
  });
});
