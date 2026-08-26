import { describe, expect, it } from "vitest";
import { AAGUID_NAMES, passkeyNameFromAaguid } from "./aaguid";

describe("passkeyNameFromAaguid（FR-01 spec §7）", () => {
  it("対応表にある AAGUID は認証器名を返す", () => {
    expect(
      passkeyNameFromAaguid(
        "fbfc3007-154e-4ecc-8c0b-6e020557d7bd",
        "multiDevice",
      ),
    ).toBe("iCloud キーチェーン");
    expect(
      passkeyNameFromAaguid(
        "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4",
        "multiDevice",
      ),
    ).toBe("Google パスワードマネージャー");
    expect(
      passkeyNameFromAaguid(
        "08987058-cadc-4b81-b6e1-30de50dcbe96",
        "singleDevice",
      ),
    ).toBe("Windows Hello");
  });

  it("大文字の AAGUID も同じ扱いにする", () => {
    expect(
      passkeyNameFromAaguid(
        "BADA5566-A7AA-401F-BD96-45619A55120D",
        "multiDevice",
      ),
    ).toBe("1Password");
  });

  it("表に無い AAGUID は deviceType で「同期パスキー」/「このデバイス」に落とす", () => {
    const unknown = "12345678-1234-1234-1234-123456789abc";
    expect(passkeyNameFromAaguid(unknown, "multiDevice")).toBe("同期パスキー");
    expect(passkeyNameFromAaguid(unknown, "singleDevice")).toBe("このデバイス");
    expect(passkeyNameFromAaguid(unknown, undefined)).toBe("このデバイス");
  });

  it("all-zero の AAGUID（attestation none で伏せられた値）は不明として扱う", () => {
    expect(
      passkeyNameFromAaguid(
        "00000000-0000-0000-0000-000000000000",
        "multiDevice",
      ),
    ).toBe("同期パスキー");
  });

  it("AAGUID が無ければ deviceType だけで決める", () => {
    expect(passkeyNameFromAaguid(undefined, "multiDevice")).toBe(
      "同期パスキー",
    );
    expect(passkeyNameFromAaguid(undefined, "singleDevice")).toBe(
      "このデバイス",
    );
  });

  it("対応表のキーは小文字の UUID 形式で、値は空でない", () => {
    for (const [aaguid, name] of Object.entries(AAGUID_NAMES)) {
      expect(aaguid).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
      expect(name.length).toBeGreaterThan(0);
    }
  });
});
