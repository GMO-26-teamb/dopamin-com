import { describe, expect, it } from "vitest";
import { API_MODE, resolveApiMode } from "./mode";

describe("resolveApiMode", () => {
  it("未設定・空文字・mock はモック", () => {
    expect(resolveApiMode(undefined)).toBe("mock");
    expect(resolveApiMode("")).toBe("mock");
    expect(resolveApiMode("mock")).toBe("mock");
  });

  it("http のときだけ実 API", () => {
    expect(resolveApiMode("http")).toBe("http");
  });

  it("綴り違いは黙ってモックに落とさず例外にする", () => {
    expect(() => resolveApiMode("HTTP")).toThrow(/NEXT_PUBLIC_API_MODE/);
    expect(() => resolveApiMode("mocks")).toThrow(/NEXT_PUBLIC_API_MODE/);
    expect(() => resolveApiMode("true")).toThrow(/NEXT_PUBLIC_API_MODE/);
  });

  it("テスト環境（未設定）ではモックが選ばれる", () => {
    expect(API_MODE).toBe("mock");
  });
});
