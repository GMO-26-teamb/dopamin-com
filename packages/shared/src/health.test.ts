import { describe, expect, it } from "vitest";
import {
  dbHealthSchema,
  healthResponseSchema,
  registryHealthSchema,
} from "./health";

const OK_DB = { ok: true, latencyMs: 3 };

describe("healthResponseSchema", () => {
  it("status ok + レジストリ疎通結果 + DB 接続結果を受理する", () => {
    const body = {
      status: "ok",
      registries: [
        {
          id: "kitaqsign",
          ok: true,
          latencyMs: 120,
          specVersion: "2026-08-25",
        },
        {
          id: "kitaqnic",
          ok: false,
          latencyMs: 5000,
          error: "timeout",
          specVersion: "2026-08-25",
        },
      ],
      db: OK_DB,
    };
    expect(healthResponseSchema.parse(body)).toEqual(body);
  });

  it("registries / db が無いと弾く", () => {
    expect(healthResponseSchema.safeParse({ status: "ok" }).success).toBe(
      false,
    );
    expect(
      healthResponseSchema.safeParse({ status: "ok", registries: [] }).success,
    ).toBe(false);
  });

  it("status は ok のみ受理する（レジストリ・DB の障害は個別の項目に出す）", () => {
    expect(
      healthResponseSchema.safeParse({
        status: "down",
        registries: [],
        db: OK_DB,
      }).success,
    ).toBe(false);
  });
});

describe("registryHealthSchema", () => {
  it("未知のレジストリ ID を弾く", () => {
    expect(
      registryHealthSchema.safeParse({
        id: "onamae",
        ok: true,
        latencyMs: 1,
        specVersion: "x",
      }).success,
    ).toBe(false);
  });

  it("specVersion は必須（どの仕様前提のコードが動いているかを常に出す。§11.5 手順 4）", () => {
    expect(
      registryHealthSchema.safeParse({ id: "mock", ok: true, latencyMs: 1 })
        .success,
    ).toBe(false);
  });
});

describe("dbHealthSchema", () => {
  it("失敗時は分類だけを載せる", () => {
    const parsed = dbHealthSchema.parse({
      ok: false,
      latencyMs: 30,
      error: "ConnectionError",
    });
    expect(parsed.error).toBe("ConnectionError");
  });

  it("成功時は error を省略できる", () => {
    expect(dbHealthSchema.parse(OK_DB).error).toBeUndefined();
  });

  it("latencyMs は非負の整数", () => {
    expect(dbHealthSchema.safeParse({ ok: true, latencyMs: -1 }).success).toBe(
      false,
    );
  });
});
