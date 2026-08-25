import { healthResponseSchema } from "@dopamin/shared";
import { describe, expect, it } from "vitest";
import app from "../../src/index";

// シェル環境に REGISTRY_MODE 等が残っていても実レジストリに向かわないよう mock に固定する
// （env は初回リクエスト時に遅延評価されるため、import 後の代入で間に合う）
process.env.REGISTRY_MODE = "mock";
process.env.MOCK_REGISTRY_FAIL_MODE = "none";

describe("GET /api/v1/health", () => {
  it("status ok とレジストリ疎通結果を返す", async () => {
    const res = await app.request("/api/v1/health");
    expect(res.status).toBe(200);
    const body = healthResponseSchema.parse(await res.json());
    expect(body.status).toBe("ok");
    expect(body.registries.length).toBeGreaterThan(0);
    expect(body.registries.every((r) => r.ok)).toBe(true);
  });

  it("x-request-id ヘッダを返す", async () => {
    const res = await app.request("/api/v1/health");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});

describe("未定義ルート", () => {
  it("統一エラー形式の 404 を返す", async () => {
    const res = await app.request("/api/v1/nonexistent");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
