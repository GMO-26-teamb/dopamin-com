import { TRANSFER_AUTO_APPROVE_MS } from "@dopamin/shared";
import { describe, expect, it } from "vitest";
import { RegistryError } from "./errors";
import { MockRegistryAdapter } from "./mock";
import type { RegistryCallRecord } from "./observer";

async function expectRegistryError(
  promise: Promise<unknown>,
  code: RegistryError["code"],
): Promise<RegistryError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(RegistryError);
  const registryError = err as RegistryError;
  expect(registryError.code).toBe(code);
  return registryError;
}

describe("MockRegistryAdapter: ライフサイクル", () => {
  it("check → create → info → renew → update → delete → restore が実レジストリ同様に遷移する", async () => {
    const mock = new MockRegistryAdapter();
    const name = "dopamin-demo.com";

    expect((await mock.check([name]))[0]?.available).toBe(true);

    const created = await mock.create({
      name,
      periodYears: 1,
      authInfo: "secret-auth",
    });
    expect(created.statuses).toEqual(["inactive"]); // NS 未設定
    expect(created.rgpStatuses).toEqual(["addPeriod"]);
    expect(created.expiresAt).toBeTruthy();

    expect((await mock.check([name]))[0]?.available).toBe(false);

    const info = await mock.info(name);
    const before = info.expiresAt;
    if (!before) {
      throw new Error("expiresAt がありません");
    }

    const renewed = await mock.renew(name, {
      periodYears: 2,
      currentExpiresAt: before,
    });
    if (!renewed.expiresAt) {
      throw new Error("renew 後の expiresAt がありません");
    }
    expect(new Date(renewed.expiresAt).getUTCFullYear()).toBe(
      new Date(before).getUTCFullYear() + 2,
    );

    const withNs = await mock.update(name, {
      addNameservers: ["ns1.example.com", "ns2.example.com"],
    });
    expect(withNs.statuses).toEqual(["ok"]); // NS 設定で inactive → ok

    await mock.delete(name);
    const deleted = await mock.info(name);
    expect(deleted.statuses).toEqual(["pendingDelete"]);
    expect(deleted.rgpStatuses).toEqual(["redemptionPeriod"]);

    const restored = await mock.restore(name);
    expect(restored.statuses).toEqual(["ok"]);
    expect(restored.rgpStatuses).toEqual([]);
  });

  it("重複 create は CONFLICT、未登録 info は NOT_FOUND", async () => {
    const mock = new MockRegistryAdapter();
    await mock.create({ name: "taken.com", periodYears: 1, authInfo: "a" });
    const conflict = await expectRegistryError(
      mock.create({ name: "taken.com", periodYears: 1, authInfo: "b" }),
      "CONFLICT",
    );
    expect(conflict.registryCode).toBe(2302);

    const notFound = await expectRegistryError(
      mock.info("missing.com"),
      "NOT_FOUND",
    );
    expect(notFound.registryCode).toBe(2303);
  });

  it("renew は curExpDate 不一致を拒否する", async () => {
    const mock = new MockRegistryAdapter();
    await mock.create({
      name: "renew-test.com",
      periodYears: 1,
      authInfo: "a",
    });
    await expectRegistryError(
      mock.renew("renew-test.com", {
        periodYears: 1,
        currentExpiresAt: "1999-01-01",
      }),
      "REGISTRY_REJECTED",
    );
  });

  it("クライアントステータスのロックが操作をブロックし、解除で通る", async () => {
    const mock = new MockRegistryAdapter();
    const name = "locked.com";
    await mock.create({ name, periodYears: 1, authInfo: "a" });

    await mock.update(name, { addStatuses: ["clientDeleteProhibited"] });
    await expectRegistryError(mock.delete(name), "OPERATION_NOT_ALLOWED");

    await mock.update(name, { removeStatuses: ["clientDeleteProhibited"] });
    await expect(mock.delete(name)).resolves.toEqual({ name });
  });

  it("clientUpdateProhibited 中でもステータス解除だけの update は通る", async () => {
    const mock = new MockRegistryAdapter();
    const name = "update-locked.com";
    await mock.create({ name, periodYears: 1, authInfo: "a" });
    await mock.update(name, { addStatuses: ["clientUpdateProhibited"] });

    // NS 変更はブロックされる
    await expectRegistryError(
      mock.update(name, { addNameservers: ["ns1.example.com"] }),
      "OPERATION_NOT_ALLOWED",
    );
    // ロック解除だけは通る
    const unlocked = await mock.update(name, {
      removeStatuses: ["clientUpdateProhibited"],
    });
    expect(unlocked.statuses).not.toContain("clientUpdateProhibited");
  });

  it("restore は redemptionPeriod 以外では拒否される", async () => {
    const mock = new MockRegistryAdapter();
    await mock.create({ name: "active.com", periodYears: 1, authInfo: "a" });
    await expectRegistryError(
      mock.restore("active.com"),
      "OPERATION_NOT_ALLOWED",
    );
  });

  it("transfer: AuthCode 不一致は拒否、一致で pendingTransfer になる", async () => {
    const mock = new MockRegistryAdapter();
    const name = "transfer-test.xyz";
    await mock.create({ name, periodYears: 1, authInfo: "initial-auth" });

    const rejected = await expectRegistryError(
      mock.transferRequest(name, "wrong"),
      "REGISTRY_REJECTED",
    );
    expect(rejected.registryCode).toBe(2202);

    const authCode = await mock.authCode(name); // rotate されるため取得値を使う
    const result = await mock.transferRequest(name, authCode);
    // 申請したのは自レジストラなので requesting = 自分、対応するのは相手レジストラ
    expect(result).toMatchObject({
      status: "pending",
      registryStatus: "pending",
      requestingRegistrarId: mock.registrarId,
      actingRegistrarId: "MOCK-FOREIGN",
    });
    // 自動承認の期限は申請から 20 分後（FR-12 / TRANSFER_AUTO_APPROVE_MS）
    expect(
      new Date(String(result.actByAt)).getTime() -
        new Date(String(result.requestedAt)).getTime(),
    ).toBe(TRANSFER_AUTO_APPROVE_MS);
    // raw は JSON 化できる状態スナップショット（ADR-0002）
    expect(JSON.parse(JSON.stringify(result.raw))).toMatchObject({
      source: "mock",
      command: "transfer_request",
      domain: name,
      pendingTransfer: true,
    });

    const info = await mock.info(name);
    expect(info.statuses).toContain("pendingTransfer");
    expect((await mock.transferQuery(name)).status).toBe("pending");
  });

  it("transfer: 移管中でなければ status none でレジストラ ID は返さない", async () => {
    const mock = new MockRegistryAdapter();
    const name = "idle-transfer.xyz";
    await mock.create({ name, periodYears: 1, authInfo: "initial-auth" });

    const queried = await mock.transferQuery(name);
    expect(queried.status).toBe("none");
    expect(queried.requestingRegistrarId).toBeUndefined();
    expect(queried.actingRegistrarId).toBeUndefined();
    expect(queried.registryStatus).toBeUndefined();
  });

  it("info の sponsoringRegistrarId は実レジストリに合わせて null（§21.2 #12）", async () => {
    const mock = new MockRegistryAdapter();
    await mock.create({ name: "clid.xyz", periodYears: 1, authInfo: "a" });
    expect((await mock.info("clid.xyz")).sponsoringRegistrarId).toBeNull();
  });
});

describe("MockRegistryAdapter: 移管の状態遷移（FR-12 AC-12-4 / AC-12-5）", () => {
  /** 移管申請中のドメインを 1 件用意する。 */
  async function pendingTransfer(
    name: string,
    now?: () => Date,
  ): Promise<MockRegistryAdapter> {
    const mock = new MockRegistryAdapter(now ? { now } : undefined);
    await mock.create({ name, periodYears: 1, authInfo: "auth" });
    await mock.transferRequest(name, "auth");
    return mock;
  }

  it("request → approve で pendingTransfer が解け、trDate と Transfer GP が付く", async () => {
    const name = "approve-me.xyz";
    const approvedAt = new Date("2026-08-26T12:00:00.000Z");
    const mock = await pendingTransfer(name, () => approvedAt);

    const before = await mock.info(name);
    expect(before.statuses).toContain("pendingTransfer");
    expect(before.lastTransferAt).toBeNull();
    const expiresBefore = before.expiresAt;

    const result = await mock.transferApprove(name);
    expect(result).toMatchObject({
      name,
      status: "approved",
      registryStatus: "clientApproved",
      requestingRegistrarId: mock.registrarId,
      actingRegistrarId: "MOCK-FOREIGN",
    });
    // 申請時の日時をそのまま返す（承認応答でも申請の文脈を失わない）
    expect(result.requestedAt).toBe(approvedAt.toISOString());
    expect(result.actByAt).toBeTruthy();
    // 実レジストリの transfer 応答に exDate が無いので mock も埋めない（ADR-0002）
    expect(result.newExpiresAt).toBeUndefined();

    const after = await mock.info(name);
    expect(after.statuses).not.toContain("pendingTransfer");
    expect(after.lastTransferAt).toBe(approvedAt.toISOString());
    expect(after.rgpStatuses).toEqual(["transferPeriod"]);
    // 移管完了で有効期限は延びない（【要確認: §21.2 #16】）
    expect(after.expiresAt).toBe(expiresBefore);
    // 移管が終わったので照会は none に戻る
    expect((await mock.transferQuery(name)).status).toBe("none");
  });

  it("request → reject は申請を取り下げるだけで保有状態は変わらない", async () => {
    const name = "reject-me.xyz";
    const mock = await pendingTransfer(name);

    const result = await mock.transferReject(name);
    expect(result).toMatchObject({
      name,
      status: "rejected",
      registryStatus: "clientRejected",
    });

    const after = await mock.info(name);
    expect(after.statuses).not.toContain("pendingTransfer");
    // 移管していないので最終移管日時も Transfer GP も付かない
    expect(after.lastTransferAt).toBeNull();
    expect(after.rgpStatuses).not.toContain("transferPeriod");
    expect((await mock.transferQuery(name)).status).toBe("none");
  });

  it("request → cancel も申請の取り下げで、以後は通常の操作に戻る", async () => {
    const name = "cancel-me.xyz";
    const mock = await pendingTransfer(name);

    const result = await mock.transferCancel(name);
    expect(result).toMatchObject({
      name,
      status: "cancelled",
      registryStatus: "clientCancelled",
    });

    const after = await mock.info(name);
    expect(after.statuses).not.toContain("pendingTransfer");
    expect(after.lastTransferAt).toBeNull();
    // pendingTransfer 中はブロックされていた更新系が通るようになる
    await expect(mock.delete(name)).resolves.toEqual({ name });
  });

  it.each(["transferApprove", "transferReject", "transferCancel"] as const)(
    "%s: 移管申請が無ければ 2304（OPERATION_NOT_ALLOWED）",
    async (method) => {
      const mock = new MockRegistryAdapter();
      const name = "idle.xyz";
      await mock.create({ name, periodYears: 1, authInfo: "auth" });

      const err = await expectRegistryError(
        mock[method](name),
        "OPERATION_NOT_ALLOWED",
      );
      expect(err.registryCode).toBe(2304);
    },
  );

  it.each(["transferApprove", "transferReject", "transferCancel"] as const)(
    "%s: 未登録ドメインは 2303（NOT_FOUND）",
    async (method) => {
      const mock = new MockRegistryAdapter();
      const err = await expectRegistryError(
        mock[method]("missing.xyz"),
        "NOT_FOUND",
      );
      expect(err.registryCode).toBe(2303);
    },
  );

  it("承認済みの移管をもう一度承認することはできない", async () => {
    const name = "twice.xyz";
    const mock = await pendingTransfer(name);
    await mock.transferApprove(name);
    await expectRegistryError(
      mock.transferApprove(name),
      "OPERATION_NOT_ALLOWED",
    );
  });

  it("移管申請中の重複申請は 2304 で拒否される", async () => {
    const name = "double-request.xyz";
    const mock = await pendingTransfer(name);
    const authCode = await mock.authCode(name);
    await expectRegistryError(
      mock.transferRequest(name, authCode),
      "OPERATION_NOT_ALLOWED",
    );
  });

  it("registrarId / foreignRegistrarId は上書きできる（direction 導出用）", async () => {
    const mock = new MockRegistryAdapter({
      registrarId: "REG-DOPAMIN",
      foreignRegistrarId: "REG-OTHER",
    });
    expect(mock.registrarId).toBe("REG-DOPAMIN");

    const name = "direction.xyz";
    await mock.create({ name, periodYears: 1, authInfo: "auth" });
    const result = await mock.transferRequest(name, "auth");
    expect(result.requestingRegistrarId).toBe("REG-DOPAMIN");
    expect(result.actingRegistrarId).toBe("REG-OTHER");
  });

  it("approve / reject / cancel も操作ログに 1 レコードずつ残る（FR-15）", async () => {
    const records: RegistryCallRecord[] = [];
    const mock = new MockRegistryAdapter({
      onCall: (record) => {
        records.push(record);
      },
    });
    const name = "logged.xyz";
    await mock.create({ name, periodYears: 1, authInfo: "auth" });

    await mock.transferRequest(name, "auth");
    await mock.transferApprove(name);
    // 申請が無い状態の reject はエラーレコードとして残る
    await expect(mock.transferReject(name)).rejects.toThrow();

    expect(records.map((r) => [r.command, r.status])).toEqual([
      ["create", "success"],
      ["transfer_request", "success"],
      ["transfer_approve", "success"],
      ["transfer_reject", "error"],
    ]);
    expect(records[3]).toMatchObject({
      errorCode: "OPERATION_NOT_ALLOWED",
      registryCode: "2304",
      domainName: name,
    });
  });
});

describe("MockRegistryAdapter: エラーシミュレーション（§11.6）", () => {
  it.each([
    ["timeout", "REGISTRY_TIMEOUT"],
    ["5xx", "REGISTRY_UNAVAILABLE"],
    ["reject", "REGISTRY_REJECTED"],
    ["spec_mismatch", "REGISTRY_SPEC_MISMATCH"],
  ] as const)("failMode=%s は %s を投げる", async (failMode, code) => {
    const mock = new MockRegistryAdapter({ failMode });
    await expectRegistryError(mock.check(["a.com"]), code);
  });

  it("failMode は approve / reject / cancel にも効く", async () => {
    const mock = new MockRegistryAdapter({ failMode: "5xx" });
    await expectRegistryError(
      mock.transferApprove("any.xyz"),
      "REGISTRY_UNAVAILABLE",
    );
    await expectRegistryError(
      mock.transferReject("any.xyz"),
      "REGISTRY_UNAVAILABLE",
    );
    await expectRegistryError(
      mock.transferCancel("any.xyz"),
      "REGISTRY_UNAVAILABLE",
    );
  });

  it("setFailMode で復帰できる", async () => {
    const mock = new MockRegistryAdapter({ failMode: "timeout" });
    await expectRegistryError(mock.hello(), "REGISTRY_TIMEOUT");
    mock.setFailMode("none");
    await expect(mock.hello()).resolves.toMatchObject({ registry: "mock" });
  });
});

describe("観測フック（FR-15: 公開メソッド 1 回 = 1 レコード）", () => {
  it("成功・失敗を問わず 1 レコード発行し、AuthCode は authInfo キーで記録する", async () => {
    const records: RegistryCallRecord[] = [];
    const adapter = new MockRegistryAdapter({
      onCall: (record) => {
        records.push(record);
      },
    });

    await adapter.create({
      name: "example.com",
      periodYears: 1,
      authInfo: "secret-auth",
    });
    const authInfo = await adapter.authCode("example.com");
    await expect(adapter.info("no-such.com")).rejects.toThrow();

    expect(records.map((r) => [r.command, r.status])).toEqual([
      ["create", "success"],
      ["auth_info", "success"],
      ["info", "error"],
    ]);
    // mock は HTTP 往復が無いので svTrid は null、clTrid は既定採番
    expect(records[0]?.svTrid).toBeNull();
    expect(records[0]?.clTrid).toMatch(/^mock-/);
    // 応答の AuthCode はマスク対象キー（authInfo）で包まれる
    expect(records[1]?.response).toEqual({ authInfo });
    expect(records[2]).toMatchObject({
      errorCode: "NOT_FOUND",
      registryCode: "2303",
      domainName: "no-such.com",
    });
  });

  it("failMode=timeout のレコードは status timeout（AC-15-1）", async () => {
    const records: RegistryCallRecord[] = [];
    const adapter = new MockRegistryAdapter({
      failMode: "timeout",
      onCall: (record) => {
        records.push(record);
      },
    });
    await expect(adapter.check(["example.com"])).rejects.toThrow();
    expect(records[0]).toMatchObject({
      command: "check",
      status: "timeout",
      errorCode: "REGISTRY_TIMEOUT",
    });
  });

  it("makeClTrid 注入時はその値を clTrid に使う", async () => {
    const records: RegistryCallRecord[] = [];
    const adapter = new MockRegistryAdapter({
      onCall: (record) => {
        records.push(record);
      },
      makeClTrid: () => "req_abc-1",
    });
    await adapter.hello();
    expect(records[0]?.clTrid).toBe("req_abc-1");
  });

  it("observer が throw しても操作は成功する", async () => {
    const adapter = new MockRegistryAdapter({
      onCall: () => {
        throw new Error("observer down");
      },
    });
    await expect(adapter.hello()).resolves.toMatchObject({ registry: "mock" });
  });
});
