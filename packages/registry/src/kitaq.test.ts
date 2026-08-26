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
      // 両レジストリの info 応答に clID 相当が無いため常に null（§21.2 #12 / ADR-0002）
      sponsoringRegistrarId: null,
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

describe("transfer（fixture → TransferResult への正規化。ADR-0002）", () => {
  it("kitaqnic は reDate / acDate を requestedAt / actByAt にマップする", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(loadFixture("transfer-request.kitaqnic.json"), 202),
    );
    const result = await createKitaqAdapter({
      ...CONFIG,
      id: "kitaqnic",
    }).transferRequest("example.xyz", "s3cr3t-pass");

    expect(requestAt(0)).toMatchObject({
      method: "POST",
      path: "/api/v1/epp/domains/example.xyz/transfer/request",
      body: { op: "request", authInfo: "s3cr3t-pass" },
    });
    expect(result).toMatchObject({
      name: "example.xyz",
      status: "pending",
      requestingRegistrarId: "REG-DOPAMIN",
      actingRegistrarId: "REG-OTHER",
      requestedAt: "2026-08-26T10:00:00Z",
      actByAt: "2026-08-26T10:20:00Z",
    });
    // 生の status は必ず残す（値域が未確定なため。§21.2 #13）
    expect(result.registryStatus).toBe("pending");
    // raw にはエンベロープごと入れる（障害調査で svTRID を突合できるように）
    expect(result.raw).toMatchObject({
      result: { code: 1001 },
      trID: { svTRID: "KQNIC-20260825-000004" },
    });
  });

  it("kitaqsign は reDate / acDate を返さないので requestedAt / actByAt は undefined", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(loadFixture("transfer-request.kitaqsign.json"), 202),
    );
    const result = await createKitaqAdapter(CONFIG).transferRequest(
      "example.com",
      "pass",
    );

    expect(result.requestedAt).toBeUndefined();
    expect(result.actByAt).toBeUndefined();
    // exDate は両レジストリの transfer 応答に無いため常に undefined
    expect(result.newExpiresAt).toBeUndefined();
  });

  it.each([
    ["clientApproved", "approved"],
    ["serverApproved", "approved"],
    ["clientRejected", "rejected"],
    ["clientCancelled", "cancelled"],
    ["pending", "pending"],
    ["まったく未知の値", "pending"],
  ])("生ステータス %s は %s に正規化される", async (raw, expected) => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        envelope({
          domain: "example.com",
          status: raw,
          gainingRegistrar: "REG-DOPAMIN",
          losingRegistrar: "REG-OTHER",
        }),
        202,
      ),
    );
    const result = await createKitaqAdapter(CONFIG).transferRequest(
      "example.com",
      "pass",
    );
    expect(result.status).toBe(expected);
    expect(result.registryStatus).toBe(raw);
  });

  it("transferQuery は info の pendingTransfer から状態を導出する", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(loadFixture("domain-info.pending-transfer.json")),
      )
      .mockResolvedValueOnce(jsonResponse(loadFixture("domain-info.json")));
    const adapter = createKitaqAdapter(CONFIG);

    const pending = await adapter.transferQuery("example.com");
    expect(requestAt(0)).toMatchObject({
      method: "GET",
      path: "/api/v1/epp/domains/example.com",
    });
    expect(pending.status).toBe("pending");
    // 導出元は info なので raw も info のエンベロープになる
    expect(pending.raw).toMatchObject({
      trID: { svTRID: "KQSGN-20260825-000005" },
    });

    const idle = await adapter.transferQuery("example.com");
    expect(idle.status).toBe("none");
    // info からはレジストラ ID も申請日時も取れない
    expect(idle.requestingRegistrarId).toBeUndefined();
    expect(idle.actingRegistrarId).toBeUndefined();
    expect(idle.requestedAt).toBeUndefined();
  });
});

describe("transfer approve / reject / cancel（§11.1 / FR-12 AC-12-4）", () => {
  /** DomainTransferResponse 形の成功エンベロープ。 */
  function transferEnvelope(status: string): unknown {
    return envelope({
      domain: "example.com",
      status,
      gainingRegistrar: "REG-OTHER",
      losingRegistrar: "REG-DOPAMIN",
    });
  }

  it.each([
    ["transferApprove", "approve", "clientApproved", "approved"],
    ["transferReject", "reject", "clientRejected", "rejected"],
    ["transferCancel", "cancel", "clientCancelled", "cancelled"],
  ] as const)(
    "%s は POST /transfer/%s を呼び、応答を TransferResult に正規化する",
    async (method, op, registryStatus, expected) => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(transferEnvelope(registryStatus)),
      );
      const result = await createKitaqAdapter(CONFIG)[method]("example.com");

      expect(requestAt(0)).toMatchObject({
        method: "POST",
        path: `/api/v1/epp/domains/example.com/transfer/${op}`,
      });
      // Swagger は approve / reject / cancel に requestBody を宣言していないので送らない
      // （restore / rotate-auth-info と同じ流儀）
      expect(requestAt(0).body).toBeUndefined();
      expect(result).toMatchObject({
        name: "example.com",
        status: expected,
        registryStatus,
        // レジストリ語彙 → 視点非依存の語彙（ADR-0002 決定 3）
        requestingRegistrarId: "REG-OTHER",
        actingRegistrarId: "REG-DOPAMIN",
      });
      // transfer 応答に exDate が無いので新有効期限は埋まらない
      expect(result.newExpiresAt).toBeUndefined();
      expect(result.raw).toMatchObject({ trID: { svTRID: "KQSGN-TEST-1" } });
    },
  );

  it.each([
    ["transferApprove", "approved"],
    ["transferReject", "rejected"],
    ["transferCancel", "cancelled"],
  ] as const)(
    "%s: 未知の生ステータスは呼んだ操作の結果（%s）に倒す",
    async (method, expected) => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(transferEnvelope("まったく未知の値")),
      );
      const result = await createKitaqAdapter(CONFIG)[method]("example.com");
      expect(result.status).toBe(expected);
      // 生値は必ず残す（値域が未確定なため。§21.2 #13）
      expect(result.registryStatus).toBe("まったく未知の値");
    },
  );

  it("approve 応答が pending を返したら pending のまま扱う", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(transferEnvelope("pending")));
    const result =
      await createKitaqAdapter(CONFIG).transferApprove("example.com");
    expect(result.status).toBe("pending");
  });

  it("移管申請が無いときの 2304 は OPERATION_NOT_ALLOWED になる", async () => {
    // 実レジストリは「転送リクエスト不在」を HTTP 409 で返す（両 openapi.json）
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          result: {
            code: 2304,
            message: "Object status prohibits operation",
            reason: "no pending transfer",
          },
          trID: { clTRID: "dp-test", svTRID: "KQSGN-TEST-3" },
        },
        409,
      ),
    );
    const err = await createKitaqAdapter(CONFIG)
      .transferApprove("example.com")
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(RegistryError);
    expect((err as RegistryError).code).toBe("OPERATION_NOT_ALLOWED");
    expect((err as RegistryError).registryCode).toBe(2304);
  });

  it("ドメイン名は URL エンコードされ、応答の domain は小文字化される", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        envelope({
          domain: "EXAMPLE.COM",
          status: "clientApproved",
          gainingRegistrar: "REG-OTHER",
          losingRegistrar: "REG-DOPAMIN",
        }),
      ),
    );
    const result =
      await createKitaqAdapter(CONFIG).transferApprove("exa mple.com");
    expect(requestAt(0).path).toBe(
      "/api/v1/epp/domains/exa%20mple.com/transfer/approve",
    );
    expect(result.name).toBe("example.com");
  });

  it("registrarId を公開する（direction 導出用。ADR-0002 決定 3）", () => {
    expect(createKitaqAdapter(CONFIG).registrarId).toBe("registrar-1");
  });

  it("approve / reject / cancel は操作ログに専用コマンド名で残る（FR-15）", async () => {
    const records: RegistryCallRecord[] = [];
    fetchMock
      .mockResolvedValueOnce(jsonResponse(transferEnvelope("clientApproved")))
      .mockResolvedValueOnce(jsonResponse(transferEnvelope("clientRejected")))
      .mockResolvedValueOnce(jsonResponse(transferEnvelope("clientCancelled")));
    const adapter = createKitaqAdapter({
      ...CONFIG,
      onCall: (record) => {
        records.push(record);
      },
    });

    await adapter.transferApprove("example.com");
    await adapter.transferReject("example.com");
    await adapter.transferCancel("example.com");

    expect(records.map((r) => [r.command, r.domainName])).toEqual([
      ["transfer_approve", "example.com"],
      ["transfer_reject", "example.com"],
      ["transfer_cancel", "example.com"],
    ]);
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

describe("poll / ackMessage（§11.1 / FR-12 AC-12-4。レジストリ差はエンドポイントだけ）", () => {
  it("kitaqsign: GET /messages/poll から最古の通知を取り出す", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(loadFixture("poll.kitaqsign.json")),
    );
    const message = await createKitaqAdapter(CONFIG).poll();
    expect(requestAt(0)).toMatchObject({
      method: "GET",
      path: "/api/v1/epp/messages/poll",
    });
    expect(message).toMatchObject({
      // int64 は string に正規化する（ADR-0002 決定 8）
      id: "1042",
      count: 2,
      queuedAt: "2026-08-26T10:00:00Z",
      // msgType から動詞が読めないので payload.status（pending）へフォールバックする
      type: "transfer_request",
      domainName: "example.com",
      transfer: {
        name: "example.com",
        status: "pending",
        registryStatus: "pending",
        requestingRegistrarId: "REG-OTHER",
        actingRegistrarId: "REG-DOPAMIN",
      },
    });
    // kitaqsign の payload には reDate / acDate が無い
    expect(message?.transfer?.requestedAt).toBeUndefined();
    expect(message?.transfer?.actByAt).toBeUndefined();
  });

  it("kitaqnic: GET /messages から取り出し、msgType だけで種別が決まる", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(loadFixture("poll.kitaqnic.json")),
    );
    const message = await createKitaqAdapter({
      ...CONFIG,
      id: "kitaqnic",
    }).poll();
    expect(requestAt(0)).toMatchObject({
      method: "GET",
      path: "/api/v1/epp/messages",
    });
    expect(message).toMatchObject({
      id: "2087",
      count: 1,
      type: "transfer_approved",
      domainName: "example.xyz",
      transfer: {
        status: "approved",
        registryStatus: "clientApproved",
        requestingRegistrarId: "REG-DOPAMIN",
        actingRegistrarId: "REG-OTHER",
        requestedAt: "2026-08-26T10:00:00Z",
        actByAt: "2026-08-26T10:20:00Z",
      },
    });
  });

  it("通知が無ければ null（count 0 / message 省略）", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(loadFixture("poll-empty.json")),
    );
    await expect(createKitaqAdapter(CONFIG).poll()).resolves.toBeNull();
  });

  it("message: null の応答も通知なしとして扱う", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(envelope({ count: 0, message: null })),
    );
    await expect(createKitaqAdapter(CONFIG).poll()).resolves.toBeNull();
  });

  it("未知の msgType は unknown に倒し、通知そのものは落とさない（ADR-0002 決定 9）", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        envelope({
          count: 1,
          message: {
            id: 7,
            msgType: "lowBalanceNotice",
            payload: { threshold: 1000 },
            qdate: "2026-08-26T11:00:00Z",
          },
        }),
      ),
    );
    const message = await createKitaqAdapter(CONFIG).poll();
    expect(message).toMatchObject({ id: "7", type: "unknown" });
    // 対象ドメインも移管情報も取れないが、生応答は raw に残る
    expect(message?.domainName).toBeUndefined();
    expect(message?.transfer).toBeUndefined();
    expect(message?.raw).toMatchObject({ result: { code: 1000 } });
  });

  it("payload が想定外の形でも id / type までは持ち上げる", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        envelope({
          count: 1,
          message: {
            id: 8,
            msgType: "transfer:reject",
            payload: "移管が拒否されました",
            qdate: "2026-08-26T11:00:00Z",
          },
        }),
      ),
    );
    const message = await createKitaqAdapter(CONFIG).poll();
    // payload からドメイン名が取れないので transfer は組み立てない
    expect(message).toMatchObject({ id: "8", type: "transfer_rejected" });
    expect(message?.transfer).toBeUndefined();
  });

  it("payload の 1 フィールドが想定外の型でも、読めた分は落とさない", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        envelope({
          count: 1,
          message: {
            id: 11,
            msgType: "transferApproved",
            payload: {
              domain: "z.com",
              status: "clientApproved",
              // 日付が ISO 文字列ではなく epoch 数値で来たケース
              acDate: 1_756_200_000,
            },
            qdate: "2026-08-26T11:00:00Z",
          },
        }),
      ),
    );
    const message = await createKitaqAdapter(CONFIG).poll();
    // acDate だけが落ち、domain / status は生き残る
    expect(message).toMatchObject({
      type: "transfer_approved",
      domainName: "z.com",
      transfer: { name: "z.com", status: "approved" },
    });
    expect(message?.transfer?.actByAt).toBeUndefined();
  });

  it("msgType に動詞が無く status が配列でも、対象ドメインは失わない", async () => {
    // このレジストリの domain:info は status を配列で返す。payload も同じ形で来うる
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        envelope({
          count: 1,
          message: {
            id: 12,
            msgType: "domain:transfer",
            payload: {
              domain: "z.com",
              status: ["pendingTransfer"],
              gainingRegistrar: "REG-OTHER",
            },
            qdate: "2026-08-26T11:00:00Z",
          },
        }),
      ),
    );
    const message = await createKitaqAdapter(CONFIG).poll();
    // status が読めないので種別は決められない（unknown に倒す）が、
    // 対象ドメインは分かるので消化側が突き合わせられる
    expect(message).toMatchObject({
      id: "12",
      type: "unknown",
      domainName: "z.com",
    });
  });

  it("移管と無関係な通知は status が pending でも移管通知にしない", async () => {
    // matchTransferStatus は部分一致なので、ライフサイクル通知の pendingDelete /
    // pendingRestore を移管として拾ってしまわないことを固定する
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        envelope({
          count: 1,
          message: {
            id: 13,
            msgType: "domainDeleteScheduled",
            payload: { domain: "victim.com", status: "pendingDelete" },
            qdate: "2026-08-26T11:00:00Z",
          },
        }),
      ),
    );
    const message = await createKitaqAdapter(CONFIG).poll();
    expect(message).toMatchObject({
      id: "13",
      type: "unknown",
      domainName: "victim.com",
    });
    // 移管ではないので TransferResult を捏造しない
    expect(message?.transfer).toBeUndefined();
  });

  it("msgType が EPP 由来（trnData）なら移管通知として扱う", async () => {
    // EPP の Poll は <domain:trnData> で移管を伝える。payload に移管固有の
    // フィールドが無くても msgType だけで移管と判断できる必要がある
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        envelope({
          count: 1,
          message: {
            id: 14,
            msgType: "trnData",
            payload: { domain: "epp.com", status: "clientApproved" },
            qdate: "2026-08-26T11:00:00Z",
          },
        }),
      ),
    );
    const message = await createKitaqAdapter(CONFIG).poll();
    expect(message).toMatchObject({
      id: "14",
      type: "transfer_approved",
      domainName: "epp.com",
      transfer: { status: "approved", registryStatus: "clientApproved" },
    });
  });

  it("msgType が読めなくても payload の形（gainingRegistrar 等）で移管と判断する", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        envelope({
          count: 1,
          message: {
            id: 15,
            msgType: "9001",
            payload: {
              domain: "shape.com",
              status: "pending",
              gainingRegistrar: "REG-DOPAMIN",
              losingRegistrar: "REG-OTHER",
            },
            qdate: "2026-08-26T11:00:00Z",
          },
        }),
      ),
    );
    const message = await createKitaqAdapter(CONFIG).poll();
    expect(message).toMatchObject({
      id: "15",
      type: "transfer_request",
      domainName: "shape.com",
      transfer: { status: "pending", requestingRegistrarId: "REG-DOPAMIN" },
    });
  });

  it("count の欠落は REGISTRY_SPEC_MISMATCH（必須フィールド）", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(envelope({})));
    const err = await createKitaqAdapter(CONFIG)
      .poll()
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(RegistryError);
    expect((err as RegistryError).code).toBe("REGISTRY_SPEC_MISMATCH");
  });

  it("kitaqsign の ack は POST /messages/{id}/ack", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(envelope()));
    await createKitaqAdapter(CONFIG).ackMessage("1042");
    expect(requestAt(0)).toMatchObject({
      method: "POST",
      path: "/api/v1/epp/messages/1042/ack",
    });
  });

  it("kitaqnic の ack は DELETE /messages/{id}", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(envelope()));
    await createKitaqAdapter({ ...CONFIG, id: "kitaqnic" }).ackMessage("2087");
    expect(requestAt(0)).toMatchObject({
      method: "DELETE",
      path: "/api/v1/epp/messages/2087",
    });
  });

  it("整数でないメッセージ ID は送信せず REGISTRY_SPEC_MISMATCH で落とす", async () => {
    const err = await createKitaqAdapter(CONFIG)
      .ackMessage("not-a-number")
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(RegistryError);
    expect((err as RegistryError).code).toBe("REGISTRY_SPEC_MISMATCH");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("poll / ack は操作ログに専用コマンド名で残る（FR-15）", async () => {
    const records: RegistryCallRecord[] = [];
    fetchMock
      .mockResolvedValueOnce(jsonResponse(loadFixture("poll.kitaqsign.json")))
      .mockResolvedValueOnce(jsonResponse(envelope()));
    const adapter = createKitaqAdapter({
      ...CONFIG,
      onCall: (record) => {
        records.push(record);
      },
    });

    const message = await adapter.poll();
    await adapter.ackMessage(String(message?.id));

    // 対象ドメインは payload を読むまで決まらないため domainName は null（§9.1 は null 可）
    expect(records.map((r) => [r.command, r.domainName])).toEqual([
      ["poll", null],
      ["ack", null],
    ]);
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
