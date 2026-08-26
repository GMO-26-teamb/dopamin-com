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
    expect(result).toMatchObject({
      status: "pending",
      registryStatus: "pending",
      requestingRegistrarId: "MOCK-GAINING",
      actingRegistrarId: "MOCK-LOSING",
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
