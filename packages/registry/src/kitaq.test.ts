import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegistryError } from "./errors";
import type { KitaqAdapterConfig } from "./http";
import { createKitaqAdapter } from "./kitaq";
import type { RegistryCallRecord } from "./observer";

/**
 * KitaqRegistryAdapter の契約テスト。fetch をスタブし、fixture
 * （docs/registry/fixtures/、CLAUDE.md）を本番のパース経路に通して
 * レジストリ応答 → 正規化型の変換とコマンドのオーケストレーションを検証する。
 */

function loadFixture(name: string): unknown {
  const path = fileURLToPath(
    new URL(`../../../docs/registry/fixtures/${name}`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8"));
}

const CONFIG: KitaqAdapterConfig = {
  id: "kitaqsign",
  baseUrl: "https://epp.example.test",
  gateUser: "gate-user",
  gatePassword: "gate-pass",
  registrarId: "registrar-1",
  apiKey: "api-key-1",
};

/** 成功エンベロープを組み立てる（resData 省略可）。 */
function envelope(resData?: unknown): unknown {
  return {
    result: { code: 1000, message: "Command completed successfully" },
    ...(resData === undefined ? {} : { resData }),
    trID: { clTRID: "dp-test", svTRID: "KQSGN-TEST-1" },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const fetchMock = vi.fn<typeof fetch>();

/** i 番目の fetch 呼び出しの { method, path, body } を取り出す。 */
function requestAt(i: number): {
  method: string;
  path: string;
  body: unknown;
} {
  const call = fetchMock.mock.calls[i];
  if (!call) {
    throw new Error(`fetch の ${i} 番目の呼び出しがありません`);
  }
  const [url, init] = call;
  return {
    method: init?.method ?? "GET",
    path: new URL(String(url)).pathname,
    body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hello（レジストリごとの resData 形状差の吸収）", () => {
  it("kitaqsign: resData.tlds から対応 TLD を得る", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(loadFixture("hello.kitaqsign.json")),
    );
    const result = await createKitaqAdapter(CONFIG).hello();
    expect(result).toEqual({
      registry: "kitaqsign",
      tlds: ["com", "net", "org", "info"],
    });
    expect(requestAt(0)).toMatchObject({
      method: "GET",
      path: "/api/v1/epp/sessions/hello",
    });
  });

  it("kitaqnic: resData.info.supportedTlds から対応 TLD を得る", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(loadFixture("hello.kitaqnic.json")),
    );
    const result = await createKitaqAdapter({
      ...CONFIG,
      id: "kitaqnic",
    }).hello();
    expect(result.registry).toBe("kitaqnic");
    expect(result.tlds).toContain("xyz");
    expect(result.tlds).toHaveLength(18);
  });

  it("TLD は小文字化される", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(envelope({ tlds: ["COM", "Net"] })),
    );
    const result = await createKitaqAdapter(CONFIG).hello();
    expect(result.tlds).toEqual(["com", "net"]);
  });
});

describe("check（fixture → CheckResult への変換）", () => {
  it("avail → available / reason を変換し、名前を小文字化する", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(loadFixture("check.json")));
    const results = await createKitaqAdapter(CONFIG).check([
      "available-example.com",
      "taken-example.com",
    ]);
    expect(results).toEqual([
      { name: "available-example.com", available: true },
      { name: "taken-example.com", available: false, reason: "in use" },
    ]);
    expect(requestAt(0)).toMatchObject({
      method: "POST",
      path: "/api/v1/epp/domains/check",
      body: { names: ["available-example.com", "taken-example.com"] },
    });
  });
});

describe("info（fixture → DomainInfo への正規化）", () => {
  it("domain-info fixture を正規化型に変換する", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(loadFixture("domain-info.json")),
    );
    const domain = await createKitaqAdapter(CONFIG).info("example.com");
    expect(domain).toEqual({
      name: "example.com",
      registry: "kitaqsign",
      statuses: ["ok"],
      registrant: "C-0001",
      contacts: { ADMIN: "C-0001", TECH: "C-0001" },
      nameservers: ["ns1.example.com", "ns2.example.com"],
      registeredAt: "2026-05-05T10:00:00Z",
      updatedAt: null,
      expiresAt: "2027-05-05T10:00:00Z",
      lastTransferAt: null,
      rgpStatuses: ["addPeriod"],
    });
  });

  it("result 2303 は NOT_FOUND の RegistryError になる", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(loadFixture("error-2303.json"), 404),
    );
    const err = await createKitaqAdapter(CONFIG)
      .info("example.com")
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(RegistryError);
    expect((err as RegistryError).code).toBe("NOT_FOUND");
    expect((err as RegistryError).registryCode).toBe(2303);
  });
});

describe("create（コンタクト作成 → create → info のオーケストレーション）", () => {
  it("ダミー PII でコンタクトを作成し、その ID を registrant に指定して登録する", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(envelope())) // contact:create
      .mockResolvedValueOnce(
        jsonResponse(
          envelope({
            domain: "example.com",
            crDate: "2026-08-25T00:00:00Z",
            exDate: "2027-08-25T00:00:00Z",
          }),
        ),
      ) // create
      .mockResolvedValueOnce(jsonResponse(loadFixture("domain-info.json"))); // info

    const domain = await createKitaqAdapter(CONFIG).create({
      name: "example.com",
      periodYears: 1,
      authInfo: "secret-auth",
    });

    const contactReq = requestAt(0);
    expect(contactReq).toMatchObject({
      method: "POST",
      path: "/api/v1/epp/contacts",
    });
    const contactId = (contactReq.body as { id: string }).id;
    expect(contactId).toMatch(/^dp-/);

    const createReq = requestAt(1);
    expect(createReq).toMatchObject({
      method: "POST",
      path: "/api/v1/epp/domains",
      body: {
        domain: "example.com",
        period: { unit: "Y", value: 1 },
        registrant: contactId,
        authInfo: "secret-auth",
      },
    });

    expect(requestAt(2)).toMatchObject({
      method: "GET",
      path: "/api/v1/epp/domains/example.com",
    });
    expect(domain.name).toBe("example.com");
  });
});

describe("renew（curExpDate の日付変換）", () => {
  it("currentExpiresAt を YYYY-MM-DD に丸めて送る", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          envelope({ domain: "example.com", exDate: "2028-05-05T10:00:00Z" }),
        ),
      ) // renew
      .mockResolvedValueOnce(jsonResponse(loadFixture("domain-info.json"))); // info

    await createKitaqAdapter(CONFIG).renew("example.com", {
      periodYears: 1,
      currentExpiresAt: "2027-05-05T10:00:00Z",
    });

    expect(requestAt(0)).toMatchObject({
      method: "POST",
      path: "/api/v1/epp/domains/example.com/renew",
      body: { curExpDate: "2027-05-05", period: { unit: "Y", value: 1 } },
    });
  });
});

describe("update（ensureHosts と resData 形状差の吸収）", () => {
  it("未作成ホストは host:info の 2303 → host:create で自動作成してから update する", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(loadFixture("error-2303.json"), 404)) // host:info
      .mockResolvedValueOnce(jsonResponse(envelope())) // host:create
      .mockResolvedValueOnce(jsonResponse(envelope())) // update（kitaqnic 形: resData 空）
      .mockResolvedValueOnce(jsonResponse(loadFixture("domain-info.json"))); // info fallback

    const domain = await createKitaqAdapter(CONFIG).update("example.com", {
      addNameservers: ["ns9.example.net"],
    });

    expect(requestAt(0)).toMatchObject({
      method: "GET",
      path: "/api/v1/epp/hosts/ns9.example.net",
    });
    expect(requestAt(1)).toMatchObject({
      method: "POST",
      path: "/api/v1/epp/hosts",
      body: { name: "ns9.example.net" },
    });
    expect(requestAt(2)).toMatchObject({
      method: "PUT",
      path: "/api/v1/epp/domains/example.com",
      body: { add: { nameservers: ["ns9.example.net"] } },
    });
    // resData がドメイン情報でない場合は info で取り直す
    expect(requestAt(3)).toMatchObject({
      method: "GET",
      path: "/api/v1/epp/domains/example.com",
    });
    expect(domain.name).toBe("example.com");
  });

  it("既存ホストは作成をスキップし、DomainResponse 形の resData はそのまま使う", async () => {
    const infoFixture = loadFixture("domain-info.json") as {
      resData: unknown;
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(envelope())) // host:info（存在する）
      .mockResolvedValueOnce(jsonResponse(envelope(infoFixture.resData))); // update（kitaqsign 形）

    const domain = await createKitaqAdapter(CONFIG).update("example.com", {
      addNameservers: ["ns1.example.com"],
    });

    // 追加の info 呼び出しをせず 2 リクエストで完結する
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(domain.name).toBe("example.com");
  });

  it("host:create の 2302（並行作成による既存）は無視して続行する", async () => {
    const infoFixture = loadFixture("domain-info.json") as {
      resData: unknown;
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(loadFixture("error-2303.json"), 404)) // host:info
      .mockResolvedValueOnce(
        jsonResponse(
          {
            result: { code: 2302, message: "Object exists" },
            trID: { svTRID: "KQSGN-TEST-2" },
          },
          409,
        ),
      ) // host:create → CONFLICT
      .mockResolvedValueOnce(jsonResponse(envelope(infoFixture.resData))); // update

    const domain = await createKitaqAdapter(CONFIG).update("example.com", {
      addNameservers: ["ns9.example.net"],
    });
    expect(domain.name).toBe("example.com");
  });
});

describe("authCode（rotate-auth-info）", () => {
  it("resData の authInfo キーを大文字小文字を無視して読み取る", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(envelope({ AuthInfo: "rotated-code" })),
    );
    const code = await createKitaqAdapter(CONFIG).authCode("example.com");
    expect(code).toBe("rotated-code");
    expect(requestAt(0)).toMatchObject({
      method: "POST",
      path: "/api/v1/epp/domains/example.com/rotate-auth-info",
    });
  });

  it("authInfo が欠落した応答は REGISTRY_SPEC_MISMATCH", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(envelope({})));
    const err = await createKitaqAdapter(CONFIG)
      .authCode("example.com")
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(RegistryError);
    expect((err as RegistryError).code).toBe("REGISTRY_SPEC_MISMATCH");
  });
});

describe("観測フック（FR-15: 1 HTTP 呼び出し = 1 レコード）", () => {
  it("create はネームサーバ指定時、補助コマンド含む独立レコードを発行する（v0.1.7 / AC-15-1）", async () => {
    const records: RegistryCallRecord[] = [];
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            result: { code: 2303, message: "Object does not exist" },
            trID: { clTRID: "dp-test", svTRID: "KQSGN-TEST-1" },
          },
          404,
        ),
      ) // host:info（未作成）
      .mockResolvedValueOnce(jsonResponse(envelope())) // host:create
      .mockResolvedValueOnce(jsonResponse(envelope())) // contact:create
      .mockResolvedValueOnce(
        jsonResponse(
          envelope({
            domain: "example.com",
            crDate: "2026-08-25T00:00:00Z",
            exDate: "2027-08-25T00:00:00Z",
          }),
        ),
      ) // create
      .mockResolvedValueOnce(jsonResponse(loadFixture("domain-info.json"))); // info

    await createKitaqAdapter({
      ...CONFIG,
      onCall: (record) => {
        records.push(record);
      },
    }).create({
      name: "example.com",
      periodYears: 1,
      authInfo: "secret-auth",
      nameservers: ["ns1.example.net"],
    });

    // host_info の NOT_FOUND（自動作成の前提確認）もエラーレコードとして独立に残る
    expect(records.map((r) => [r.command, r.status])).toEqual([
      ["host_info", "error"],
      ["host_create", "success"],
      ["contact_create", "success"],
      ["create", "success"],
      ["info", "success"],
    ]);
    // 補助コマンドも起点となったドメインに紐づく
    expect(new Set(records.map((r) => r.domainName))).toEqual(
      new Set(["example.com"]),
    );
    // record.request には送信ボディが未マスクで入る（マスクは保存側の責務）
    const createRecord = records.find((r) => r.command === "create");
    expect(createRecord?.request).toMatchObject({
      method: "POST",
      path: "/domains",
      body: { authInfo: "secret-auth" },
    });
  });
});
