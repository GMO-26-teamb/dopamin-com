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

  it("クエリとハッシュを保ったまま往復できる", () => {
    expect(safeNextPath("/domains/new?tab=ai#x")).toBe("/domains/new?tab=ai#x");
  });

  it("外部 URL・スキーム・プロトコル相対は弾く（オープンリダイレクト対策）", () => {
    expect(safeNextPath("https://evil.example/x")).toBeNull();
    expect(safeNextPath("//evil.example/x")).toBeNull();
    expect(safeNextPath("/\\evil.example/x")).toBeNull();
    expect(safeNextPath("javascript:alert(1)")).toBeNull();
    expect(safeNextPath("dashboard")).toBeNull();
  });

  it("制御文字を含むパスは弾く（URL パーサが読み飛ばして外に出る）", () => {
    // `?next=%2F%09%2Fevil.example` をデコードした値。
    // new URL("/\t/evil.example", origin).href === "https://evil.example/"
    expect(new URL("/\t/evil.example", "https://app.test").href).toBe(
      "https://evil.example/",
    );
    expect(safeNextPath("/\t/evil.example")).toBeNull();
    expect(safeNextPath("/\n/evil")).toBeNull();
    expect(safeNextPath("/\r/evil")).toBeNull();
  });

  it("%-エンコードで隠したバックスラッシュ・スラッシュも弾く", () => {
    expect(safeNextPath("/%5Cevil")).toBeNull();
    expect(safeNextPath("/%2Fevil.example")).toBeNull();
    expect(safeNextPath("/%09/evil.example")).toBeNull();
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
