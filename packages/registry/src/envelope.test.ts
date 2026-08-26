import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { interpretEppResponse, parseResData } from "./envelope";
import { RegistryError } from "./errors";
import {
  checkResDataSchema,
  domainResDataSchema,
  pollResDataSchema,
} from "./kitaq";

/** 契約テストの fixture は docs/registry/fixtures/ に置く（CLAUDE.md）。 */
function loadFixture(name: string): unknown {
  const path = fileURLToPath(
    new URL(`../../../docs/registry/fixtures/${name}`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8"));
}

function interpretError(
  input: Parameters<typeof interpretEppResponse>[0],
): RegistryError {
  try {
    interpretEppResponse(input);
  } catch (err) {
    if (err instanceof RegistryError) {
      return err;
    }
    throw err;
  }
  throw new Error("RegistryError が投げられませんでした");
}

describe("interpretEppResponse（HTTP + result.code の 2 段判定）", () => {
  it("hello 成功エンベロープ（kitaqsign）を受理する", () => {
    const { envelope } = interpretEppResponse({
      registry: "kitaqsign",
      command: "hello",
      httpStatus: 200,
      json: loadFixture("hello.kitaqsign.json"),
    });
    expect(envelope.result.code).toBe(1000);
    expect(envelope.trID.svTRID).toContain("KQSGN-");
  });

  it("hello 成功エンベロープ（kitaqnic）を受理する", () => {
    const { envelope } = interpretEppResponse({
      registry: "kitaqnic",
      command: "hello",
      httpStatus: 200,
      json: loadFixture("hello.kitaqnic.json"),
    });
    expect(envelope.result.code).toBe(1000);
  });

  it("result 2303 は NOT_FOUND に正規化される（HTTP 404 でも）", () => {
    const err = interpretError({
      registry: "kitaqsign",
      command: "info",
      httpStatus: 404,
      json: loadFixture("error-2303.json"),
    });
    expect(err.code).toBe("NOT_FOUND");
    expect(err.registryCode).toBe(2303);
    expect(err.reason).toBe("example.com not found");
  });

  it("HTTP 200 でも result 2306 なら失敗（REGISTRY_REJECTED）", () => {
    const err = interpretError({
      registry: "kitaqnic",
      command: "create",
      httpStatus: 200,
      json: {
        result: { code: 2306, message: "Parameter value policy error" },
        trID: { clTRID: "x", svTRID: "KQNIC-1" },
      },
    });
    expect(err.code).toBe("REGISTRY_REJECTED");
    expect(err.registryCode).toBe(2306);
  });

  it("result 2302 は CONFLICT、2304 は OPERATION_NOT_ALLOWED", () => {
    const conflict = interpretError({
      registry: "kitaqsign",
      command: "create",
      httpStatus: 409,
      json: {
        result: { code: 2302, message: "Object exists" },
        trID: { svTRID: "s" },
      },
    });
    expect(conflict.code).toBe("CONFLICT");

    const prohibited = interpretError({
      registry: "kitaqsign",
      command: "delete",
      httpStatus: 409,
      json: {
        result: { code: 2304, message: "Object status prohibits operation" },
        trID: { svTRID: "s" },
      },
    });
    expect(prohibited.code).toBe("OPERATION_NOT_ALLOWED");
  });

  it("message ではなく msg しか無い応答は REGISTRY_SPEC_MISMATCH（実測との差異の回帰）", () => {
    // Swagger 本文の例は msg だが実レジストリは message を返す。message 欠落は仕様変更の疑い。
    const err = interpretError({
      registry: "kitaqsign",
      command: "hello",
      httpStatus: 200,
      json: {
        result: { code: 1000, msg: "Command completed successfully" },
        trID: { svTRID: "s" },
      },
    });
    expect(err.code).toBe("REGISTRY_SPEC_MISMATCH");
  });

  it("JSON でない 5xx 応答は REGISTRY_UNAVAILABLE", () => {
    const err = interpretError({
      registry: "kitaqsign",
      command: "check",
      httpStatus: 503,
      json: undefined,
      rawSnippet: "<html>Service Unavailable</html>",
    });
    expect(err.code).toBe("REGISTRY_UNAVAILABLE");
    expect(err.httpStatus).toBe(503);
    expect(err.retryable).toBe(true);
  });

  it("JSON でない 2xx 応答は REGISTRY_SPEC_MISMATCH", () => {
    const err = interpretError({
      registry: "kitaqsign",
      command: "check",
      httpStatus: 200,
      json: undefined,
      rawSnippet: "OK",
    });
    expect(err.code).toBe("REGISTRY_SPEC_MISMATCH");
  });
});

describe("parseResData（contract: fixture → 本番 resData スキーマの検証）", () => {
  it("domain-info fixture が resData スキーマを通過する", () => {
    const { envelope } = interpretEppResponse({
      registry: "kitaqsign",
      command: "info",
      httpStatus: 200,
      json: loadFixture("domain-info.json"),
    });
    const resData = parseResData(
      "kitaqsign",
      "info",
      envelope,
      domainResDataSchema,
    );
    expect(resData.domain).toBe("example.com");
    expect(resData.status).toEqual(["ok"]);
    expect(resData.rgpStatus).toEqual(["addPeriod"]);
  });

  it("check fixture が resData スキーマを通過する", () => {
    const { envelope } = interpretEppResponse({
      registry: "kitaqsign",
      command: "check",
      httpStatus: 200,
      json: loadFixture("check.json"),
    });
    const resData = parseResData(
      "kitaqsign",
      "check",
      envelope,
      checkResDataSchema,
    );
    expect(resData.results).toHaveLength(2);
    expect(resData.results[0]?.avail).toBe(true);
    expect(resData.results[1]?.reason).toBe("in use");
  });

  it("poll fixture が resData スキーマを通過する（両レジストリで同一の形）", () => {
    for (const fixture of ["poll.kitaqsign.json", "poll.kitaqnic.json"]) {
      const { envelope } = interpretEppResponse({
        registry: "kitaqsign",
        command: "poll",
        httpStatus: 200,
        json: loadFixture(fixture),
      });
      const resData = parseResData(
        "kitaqsign",
        "poll",
        envelope,
        pollResDataSchema,
      );
      expect(resData.message?.id).toEqual(expect.any(Number));
      expect(resData.message?.msgType).toEqual(expect.any(String));
      expect(resData.message?.qdate).toEqual(expect.any(String));
    }
  });

  it("poll-empty fixture は message を持たない（未読なし）", () => {
    const { envelope } = interpretEppResponse({
      registry: "kitaqnic",
      command: "poll",
      httpStatus: 200,
      json: loadFixture("poll-empty.json"),
    });
    const resData = parseResData(
      "kitaqnic",
      "poll",
      envelope,
      pollResDataSchema,
    );
    expect(resData.count).toBe(0);
    expect(resData.message ?? null).toBeNull();
  });

  it("必須フィールド欠落は REGISTRY_SPEC_MISMATCH", () => {
    const { envelope } = interpretEppResponse({
      registry: "kitaqsign",
      command: "info",
      httpStatus: 200,
      json: {
        result: { code: 1000, message: "ok" },
        resData: { domain: "example.com" },
        trID: { svTRID: "s" },
      },
    });
    expect(() =>
      parseResData("kitaqsign", "info", envelope, domainResDataSchema),
    ).toThrowError(RegistryError);
  });
});
