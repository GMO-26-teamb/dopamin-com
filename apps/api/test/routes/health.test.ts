import type { Db } from "@dopamin/db";
import { createRegistrySet, MockRegistryAdapter } from "@dopamin/registry";
import { healthResponseSchema } from "@dopamin/shared";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import app from "../../src/index";
import { setDbForTesting } from "../../src/lib/db";
import { setRegistrySetForTesting } from "../../src/lib/registries";
import { setRetrySleepForTesting } from "../../src/lib/retry";
import { createTestDb } from "../helpers/db";

/**
 * `GET /health`（docs/requirements.md §10.1 / §11.5 手順 4）。
 * レジストリの疎通・仕様バージョンと DB 接続を、環境不備でも 200 で返せることを検証する。
 */

let db: Db;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
}, 30_000);

afterAll(async () => {
  await closeDb();
});

beforeEach(() => {
  setRetrySleepForTesting(() => Promise.resolve());
  setDbForTesting(db);
  setRegistrySetForTesting(
    createRegistrySet({
      mode: "real",
      adapters: [
        new MockRegistryAdapter({ id: "kitaqsign" }),
        new MockRegistryAdapter({ id: "kitaqnic" }),
      ],
    }),
  );
});

afterEach(() => {
  setRetrySleepForTesting(null);
  setRegistrySetForTesting(null);
  setDbForTesting(null);
});

async function health() {
  const res = await app.request("/api/v1/health");
  expect(res.status).toBe(200);
  return healthResponseSchema.parse(await res.json());
}

describe("GET /api/v1/health", () => {
  it("レジストリごとに疎通結果と specVersion を返す（§11.5 手順 4）", async () => {
    const body = await health();
    expect(body.status).toBe("ok");
    expect(body.registries.map((r) => r.id).sort()).toEqual([
      "kitaqnic",
      "kitaqsign",
    ]);
    for (const registry of body.registries) {
      expect(registry.ok).toBe(true);
      // どの仕様を前提にしたコードが動いているかを外から確認できる
      expect(registry.specVersion).toBe("mock");
      expect(registry.error).toBeUndefined();
    }
  });

  it("疎通に失敗したレジストリも specVersion 付きで返る（コードだけ・生メッセージは出さない）", async () => {
    const failing = new MockRegistryAdapter({ id: "kitaqsign" });
    failing.setFailMode("5xx");
    setRegistrySetForTesting(
      createRegistrySet({ mode: "real", adapters: [failing] }),
    );

    const body = await health();
    expect(body.status).toBe("ok");
    expect(body.registries[0]).toMatchObject({
      id: "kitaqsign",
      ok: false,
      error: "REGISTRY_UNAVAILABLE",
      specVersion: "mock",
    });
    // 認証なしで到達できるので、レジストリの生文言は載せない（FR-18 / NFR-03）
    expect(JSON.stringify(body)).not.toContain("failMode");
  });

  it("DB に接続できれば db.ok が true", async () => {
    const body = await health();
    expect(body.db.ok).toBe(true);
    expect(body.db.latencyMs).toBeGreaterThanOrEqual(0);
    expect(body.db.error).toBeUndefined();
  });

  it("DB に繋がらなくても 200 を返し、db.ok を false にする", async () => {
    class ConnectionError extends Error {
      override name = "ConnectionError";
    }
    setDbForTesting({
      execute: () => Promise.reject(new ConnectionError("ECONNREFUSED")),
    } as unknown as Db);

    const body = await health();
    // 疎通確認そのものは落とさない（どこが壊れているかを見るための口）
    expect(body.status).toBe("ok");
    expect(body.db).toMatchObject({ ok: false, error: "ConnectionError" });
    // 接続文字列・SQL は載せない
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
    // レジストリ側の結果は独立して返る
    expect(body.registries.every((r) => r.ok)).toBe(true);
  });
});
