import { describe, expect, it } from "vitest";
import {
  DEFAULT_NEXT_PATH,
  nextPathOrDefault,
  safeNextPath,
  withNext,
} from "./next-path";

describe("safeNextPath", () => {
  it("同一オリジンの絶対パスは通す（クエリ付きも）", () => {
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/domains/takutaku.com?tab=dns")).toBe(
      "/domains/takutaku.com?tab=dns",
    );
  });

  it("外部 URL・スキーム・プロトコル相対は弾く（オープンリダイレクト対策）", () => {
    expect(safeNextPath("https://evil.example/x")).toBeNull();
    expect(safeNextPath("//evil.example/x")).toBeNull();
    expect(safeNextPath("/\\evil.example/x")).toBeNull();
    expect(safeNextPath("javascript:alert(1)")).toBeNull();
    expect(safeNextPath("dashboard")).toBeNull();
  });

  it("未指定・空文字は null", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath("")).toBeNull();
  });

  it("認証画面自身とトップは弾く（ログイン後に戻るとループする）", () => {
    expect(safeNextPath("/login")).toBeNull();
    expect(safeNextPath("/signup?next=%2Fdashboard")).toBeNull();
    expect(safeNextPath("/")).toBeNull();
  });
});

describe("nextPathOrDefault", () => {
  it("安全な値はそのまま、そうでなければ /dashboard", () => {
    expect(nextPathOrDefault("/transfers")).toBe("/transfers");
    expect(nextPathOrDefault("https://evil.example")).toBe(DEFAULT_NEXT_PATH);
    expect(nextPathOrDefault(null)).toBe("/dashboard");
  });
});

describe("withNext", () => {
  it("安全な next だけをクエリに載せる", () => {
    expect(withNext("/signup", "/domains/new")).toBe(
      "/signup?next=%2Fdomains%2Fnew",
    );
    expect(withNext("/signup", null)).toBe("/signup");
    expect(withNext("/login", "//evil.example")).toBe("/login");
  });
});
