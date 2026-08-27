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
    expect(deleted.statuses).toEqual(["pendingDelete", "redemptionPeriod"]);
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
    // 移管 IN の対象は相手レジストラ保有のドメイン（自保有には申請できない）
    mock.seedForeignDomain(name, "initial-auth");

    const rejected = await expectRegistryError(
      mock.transferRequest(name, "wrong"),
      "REGISTRY_REJECTED",
    );
    expect(rejected.registryCode).toBe(2202);

    const result = await mock.transferRequest(name, "initial-auth");
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

/** seed / create で使う既定の AuthCode。 */
const AUTH = "auth-code";
/** mock 既定の相手レジストラ ID。 */
const FOREIGN = "MOCK-FOREIGN";

/** 進められる時計。自動承認の期限切れを作るために使う。 */
function clock(start: string): {
  now: () => Date;
  advance: (ms: number) => void;
} {
  let current = new Date(start);
  return {
    now: () => current,
    advance: (ms) => {
      current = new Date(current.getTime() + ms);
    },
  };
}

/** 移管 IN の申請中（自分が gaining、相手が losing）を作る。 */
async function startInbound(
  name: string,
  options?: { now?: () => Date },
): Promise<MockRegistryAdapter> {
  const mock = new MockRegistryAdapter(options);
  mock.seedForeignDomain(name, AUTH);
  await mock.transferRequest(name, AUTH);
  return mock;
}

/** 移管 OUT の申請中（自分が losing、相手が gaining）を作る。 */
async function startOutbound(
  name: string,
  options?: { now?: () => Date },
): Promise<MockRegistryAdapter> {
  const mock = new MockRegistryAdapter(options);
  await mock.create({ name, periodYears: 1, authInfo: AUTH });
  mock.simulateInboundTransferRequest(name);
  return mock;
}

describe("MockRegistryAdapter: 移管 IN（自分が gaining。FR-12 AC-12-1 / AC-12-3）", () => {
  it("相手保有ドメインへの申請が pending になり、通知は相手側の Poll に積まれる", async () => {
    const name = "inbound.xyz";
    const mock = await startInbound(name);

    const queried = await mock.transferQuery(name);
    expect(queried).toMatchObject({
      status: "pending",
      requestingRegistrarId: mock.registrarId,
      actingRegistrarId: FOREIGN,
    });
    expect((await mock.info(name)).statuses).toContain("pendingTransfer");
    // 自動承認の期限は申請から 20 分後（FR-12 / TRANSFER_AUTO_APPROVE_MS）
    expect(
      new Date(String(queried.actByAt)).getTime() -
        new Date(String(queried.requestedAt)).getTime(),
    ).toBe(TRANSFER_AUTO_APPROVE_MS);
    // 申請は losing（相手）側に届く。自分の Poll には何も積まれない
    expect(await mock.poll()).toBeNull();
  });

  it("自レジストラ保有のドメインには申請できない（【要確認: §21.2 #15】暫定 2304）", async () => {
    const mock = new MockRegistryAdapter();
    await mock.create({ name: "mine.xyz", periodYears: 1, authInfo: AUTH });
    const err = await expectRegistryError(
      mock.transferRequest("mine.xyz", AUTH),
      "OPERATION_NOT_ALLOWED",
    );
    expect(err.registryCode).toBe(2304);
  });

  it("相手がロックしていれば 2304 で拒否される", async () => {
    const mock = new MockRegistryAdapter();
    mock.seedForeignDomain("locked.xyz", AUTH, {
      clientStatuses: ["clientTransferProhibited"],
    });
    const err = await expectRegistryError(
      mock.transferRequest("locked.xyz", AUTH),
      "OPERATION_NOT_ALLOWED",
    );
    expect(err.registryCode).toBe(2304);
  });

  it("IN 承認: 相手が承認するとドメインが自レジストラ保有になり、Poll に通知が届く", async () => {
    const name = "in-approve.xyz";
    const approvedAt = new Date("2026-08-26T12:00:00.000Z");
    const mock = await startInbound(name, { now: () => approvedAt });
    // 相手保有の間は更新系が通らない
    await expectRegistryError(mock.authCode(name), "REGISTRY_REJECTED");
    const expiresBefore = (await mock.info(name)).expiresAt;

    const result = mock.simulateCounterpartApprove(name);
    expect(result).toMatchObject({
      name,
      status: "approved",
      registryStatus: "clientApproved",
      requestingRegistrarId: mock.registrarId,
      actingRegistrarId: FOREIGN,
    });

    const after = await mock.info(name);
    expect(after.statuses).not.toContain("pendingTransfer");
    expect(after.lastTransferAt).toBe(approvedAt.toISOString());
    expect(after.rgpStatuses).toEqual(["transferPeriod"]);
    // 移管完了で有効期限は延びない（【要確認: §21.2 #16】）
    expect(after.expiresAt).toBe(expiresBefore);
    // 自レジストラ保有になったので更新系が通る
    await expect(mock.authCode(name)).resolves.toEqual(expect.any(String));
    expect((await mock.transferQuery(name)).status).toBe("none");

    // 承認したのは相手なので、自分には transfer_approved の通知が積まれる
    expect(await mock.poll()).toMatchObject({
      type: "transfer_approved",
      domainName: name,
      count: 1,
      transfer: { status: "approved", registryStatus: "clientApproved" },
    });
  });

  it("IN 拒否: 相手が拒否すると保有は動かず、Poll に transfer_rejected が届く", async () => {
    const name = "in-reject.xyz";
    const mock = await startInbound(name);

    expect(mock.simulateCounterpartReject(name)).toMatchObject({
      status: "rejected",
      registryStatus: "clientRejected",
    });

    const after = await mock.info(name);
    expect(after.statuses).not.toContain("pendingTransfer");
    expect(after.lastTransferAt).toBeNull();
    expect(after.rgpStatuses).not.toContain("transferPeriod");
    // 相手保有のままなので更新系は通らない
    await expectRegistryError(mock.authCode(name), "REGISTRY_REJECTED");
    expect(await mock.poll()).toMatchObject({ type: "transfer_rejected" });
  });

  it("IN 取消: 自分で取り消すと保有は動かず、自分には通知が積まれない", async () => {
    const name = "in-cancel.xyz";
    const mock = await startInbound(name);

    expect(await mock.transferCancel(name)).toMatchObject({
      status: "cancelled",
      registryStatus: "clientCancelled",
    });
    expect((await mock.info(name)).statuses).not.toContain("pendingTransfer");
    await expectRegistryError(mock.authCode(name), "REGISTRY_REJECTED");
    // 行為者は自分なので自分の Poll には積まれない（相手には届く）
    expect(await mock.poll()).toBeNull();
  });

  it("IN 自動承認: 相手が放置しても期限後にサーバ承認で取り込まれる（AC-12-3）", async () => {
    const name = "in-auto.xyz";
    const time = clock("2026-08-26T12:00:00.000Z");
    const mock = await startInbound(name, { now: time.now });

    time.advance(TRANSFER_AUTO_APPROVE_MS);
    // 申請側（自分）が行為者ではないので、自分にも通知が届く
    expect(await mock.poll()).toMatchObject({
      type: "transfer_approved",
      domainName: name,
      transfer: { status: "approved", registryStatus: "serverApproved" },
    });
    expect((await mock.info(name)).lastTransferAt).toBe(
      time.now().toISOString(),
    );
    // 自レジストラ保有になったので更新系が通る
    await expect(mock.authCode(name)).resolves.toEqual(expect.any(String));
  });

  it("IN の申請を自分で承認・拒否することはできない（対応側は相手。2201）", async () => {
    const name = "in-role.xyz";
    const mock = await startInbound(name);
    // 呼び出しは 1 つずつ作る（先に全部作ると未 await の rejection が一瞬できる）
    const acts = [
      () => mock.transferApprove(name),
      () => mock.transferReject(name),
    ];
    for (const act of acts) {
      const err = await expectRegistryError(act(), "REGISTRY_REJECTED");
      expect(err.registryCode).toBe(2201);
    }
  });

  it("移管申請中の重複申請は 2304 で拒否される", async () => {
    const name = "double-request.xyz";
    const mock = await startInbound(name);
    await expectRegistryError(
      mock.transferRequest(name, AUTH),
      "OPERATION_NOT_ALLOWED",
    );
  });
});

describe("MockRegistryAdapter: 移管 OUT（自分が losing。FR-12 AC-12-4 / AC-12-5）", () => {
  it("受信申請で pendingTransfer になり、自分の Poll に transfer_request が積まれる", async () => {
    const name = "out-received.xyz";
    const mock = await startOutbound(name);

    expect(await mock.transferQuery(name)).toMatchObject({
      status: "pending",
      requestingRegistrarId: FOREIGN,
      actingRegistrarId: mock.registrarId,
    });
    expect((await mock.info(name)).statuses).toContain("pendingTransfer");
    expect(await mock.poll()).toMatchObject({
      type: "transfer_request",
      domainName: name,
      transfer: { status: "pending", requestingRegistrarId: FOREIGN },
    });
  });

  it("OUT 承認: 承認するとドメインは相手保有になり、以後の更新系は拒否される", async () => {
    const name = "out-approve.xyz";
    const approvedAt = new Date("2026-08-26T12:00:00.000Z");
    const mock = await startOutbound(name, { now: () => approvedAt });

    const result = await mock.transferApprove(name);
    expect(result).toMatchObject({
      status: "approved",
      registryStatus: "clientApproved",
      requestingRegistrarId: FOREIGN,
      actingRegistrarId: mock.registrarId,
    });
    // 実レジストリの transfer 応答に exDate が無いので mock も埋めない（ADR-0002）
    expect(result.newExpiresAt).toBeUndefined();

    const after = await mock.info(name);
    expect(after.statuses).not.toContain("pendingTransfer");
    expect(after.lastTransferAt).toBe(approvedAt.toISOString());
    expect(after.rgpStatuses).toEqual(["transferPeriod"]);
    // AC-12-5: 移管 OUT 完了後、そのドメインへの更新系は通らない
    const acts = [
      () =>
        mock.renew(name, {
          currentExpiresAt: after.expiresAt ?? "",
          periodYears: 1,
        }),
      () => mock.update(name, { addNameservers: ["ns9.example.net"] }),
      () => mock.delete(name),
      () => mock.authCode(name),
    ];
    for (const act of acts) {
      const err = await expectRegistryError(act(), "REGISTRY_REJECTED");
      expect(err.registryCode).toBe(2201);
    }
  });

  it("OUT 拒否: 拒否すると保有はそのままで、更新系も通り続ける", async () => {
    const name = "out-reject.xyz";
    const mock = await startOutbound(name);

    expect(await mock.transferReject(name)).toMatchObject({
      status: "rejected",
      registryStatus: "clientRejected",
    });
    const after = await mock.info(name);
    expect(after.lastTransferAt).toBeNull();
    expect(after.rgpStatuses).not.toContain("transferPeriod");
    await expect(mock.authCode(name)).resolves.toEqual(expect.any(String));
  });

  it("OUT 自動承認: 放置すると期限後の参照でサーバ承認として確定する（タイマー不使用）", async () => {
    const name = "out-auto.xyz";
    const time = clock("2026-08-26T12:00:00.000Z");
    const mock = await startOutbound(name, { now: time.now });
    // 受信申請の通知は先に消化しておく（自動承認の通知だけを見たい）
    const received = await mock.poll();
    await mock.ackMessage(String(received?.id));

    // 期限の 1ms 手前ではまだ pending
    time.advance(TRANSFER_AUTO_APPROVE_MS - 1);
    expect((await mock.transferQuery(name)).status).toBe("pending");

    time.advance(1);
    // 参照した時点で確定する（info / transferQuery / poll のいずれでも同じ）
    expect((await mock.info(name)).statuses).not.toContain("pendingTransfer");
    expect((await mock.transferQuery(name)).status).toBe("none");
    // 行為者はサーバなので、losing の自分にも通知が届く
    expect(await mock.poll()).toMatchObject({
      type: "transfer_approved",
      domainName: name,
      transfer: { status: "approved", registryStatus: "serverApproved" },
    });
    // 相手保有になっているので更新系は拒否される
    await expectRegistryError(mock.authCode(name), "REGISTRY_REJECTED");
  });

  it("自動承認は poll だけを叩いていても確定する", async () => {
    const name = "out-auto-poll.xyz";
    const time = clock("2026-08-26T12:00:00.000Z");
    const mock = await startOutbound(name, { now: time.now });
    const received = await mock.poll();
    await mock.ackMessage(String(received?.id));

    time.advance(TRANSFER_AUTO_APPROVE_MS);
    expect(await mock.poll()).toMatchObject({ type: "transfer_approved" });
  });

  it("受信申請もロック・廃止中のドメインには積まれない（transferRequest と同じ条件）", async () => {
    const mock = new MockRegistryAdapter();
    await mock.create({ name: "locked.xyz", periodYears: 1, authInfo: AUTH });
    await mock.update("locked.xyz", {
      addStatuses: ["clientTransferProhibited"],
    });
    expect(() =>
      mock.simulateInboundTransferRequest("locked.xyz"),
    ).toThrowError(RegistryError);

    await mock.create({ name: "dying.xyz", periodYears: 1, authInfo: AUTH });
    await mock.delete("dying.xyz");
    expect(() => mock.simulateInboundTransferRequest("dying.xyz")).toThrowError(
      RegistryError,
    );
  });

  it("OUT の申請を自分で取り消すことはできない（申請側は相手。2201）", async () => {
    const name = "out-role.xyz";
    const mock = await startOutbound(name);
    const err = await expectRegistryError(
      mock.transferCancel(name),
      "REGISTRY_REJECTED",
    );
    expect(err.registryCode).toBe(2201);
  });

  it("承認済みの移管をもう一度承認することはできない", async () => {
    const name = "twice.xyz";
    const mock = await startOutbound(name);
    await mock.transferApprove(name);
    await expectRegistryError(
      mock.transferApprove(name),
      "OPERATION_NOT_ALLOWED",
    );
  });

  it.each(["transferApprove", "transferReject", "transferCancel"] as const)(
    "%s: 移管申請が無ければ 2304（OPERATION_NOT_ALLOWED）",
    async (method) => {
      const mock = new MockRegistryAdapter();
      const name = "idle.xyz";
      await mock.create({ name, periodYears: 1, authInfo: AUTH });

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
});

describe("MockRegistryAdapter: 出戻り（OUT 後に同名を再び IN する。§19）", () => {
  it("移管 OUT したドメインを再び移管 IN できる", async () => {
    const name = "roundtrip.xyz";
    const mock = await startOutbound(name);
    await mock.transferApprove(name);
    expect((await mock.transferQuery(name)).status).toBe("none");

    // 相手保有になっているので、同じ名前に対して今度は自分が gaining として申請する
    const requested = await mock.transferRequest(name, AUTH);
    expect(requested).toMatchObject({
      status: "pending",
      requestingRegistrarId: mock.registrarId,
      actingRegistrarId: FOREIGN,
    });
    mock.simulateCounterpartApprove(name);

    // 自レジストラ保有に戻り、更新系も通る
    await expect(mock.authCode(name)).resolves.toEqual(expect.any(String));
    expect((await mock.info(name)).rgpStatuses).toEqual(["transferPeriod"]);
  });

  it("seed / create のどちらでも同名の二重登録は 2302", async () => {
    const mock = new MockRegistryAdapter();
    mock.seedForeignDomain("dup.xyz", AUTH);
    expect(() => mock.seedForeignDomain("dup.xyz", AUTH)).toThrowError(
      RegistryError,
    );
    await expectRegistryError(
      mock.create({ name: "dup.xyz", periodYears: 1, authInfo: AUTH }),
      "CONFLICT",
    );
  });
});

describe("MockRegistryAdapter: Poll キュー（§11.1 / FR-12）", () => {
  it("通知が無ければ null", async () => {
    await expect(new MockRegistryAdapter().poll()).resolves.toBeNull();
  });

  it("ack するまで同じ通知が返り、ack すると次が読める（FIFO）", async () => {
    const mock = new MockRegistryAdapter();
    for (const name of ["first.xyz", "second.xyz"]) {
      await mock.create({ name, periodYears: 1, authInfo: AUTH });
      mock.simulateInboundTransferRequest(name);
    }

    const first = await mock.poll();
    expect(first).toMatchObject({ domainName: "first.xyz", count: 2 });
    // ack しない限り同じメッセージが返り続ける
    expect((await mock.poll())?.id).toBe(first?.id);

    await mock.ackMessage(String(first?.id));
    const second = await mock.poll();
    expect(second).toMatchObject({ domainName: "second.xyz", count: 1 });

    await mock.ackMessage(String(second?.id));
    expect(await mock.poll()).toBeNull();
  });

  it("メッセージ ID は数字だけの文字列（ack のパスに埋められる形。ADR-0002 決定 8）", async () => {
    const mock = new MockRegistryAdapter();
    await mock.create({ name: "id.xyz", periodYears: 1, authInfo: AUTH });
    mock.simulateInboundTransferRequest("id.xyz");
    expect((await mock.poll())?.id).toMatch(/^\d+$/);
  });

  it("存在しないメッセージの ack は 2303（NOT_FOUND）", async () => {
    const mock = new MockRegistryAdapter();
    const err = await expectRegistryError(mock.ackMessage("999"), "NOT_FOUND");
    expect(err.registryCode).toBe(2303);
  });

  it("raw は JSON 化できる状態スナップショット（ADR-0002 決定 5）", async () => {
    const mock = new MockRegistryAdapter();
    await mock.create({ name: "raw.xyz", periodYears: 1, authInfo: AUTH });
    mock.simulateInboundTransferRequest("raw.xyz");
    const message = await mock.poll();
    expect(JSON.parse(JSON.stringify(message?.raw))).toMatchObject({
      source: "mock",
      command: "poll",
      domain: "raw.xyz",
      count: 1,
    });
  });

  it("poll / ack も操作ログに 1 レコードずつ残る（FR-15）", async () => {
    const records: RegistryCallRecord[] = [];
    const mock = new MockRegistryAdapter({
      onCall: (record) => {
        records.push(record);
      },
    });
    await mock.create({ name: "logged.xyz", periodYears: 1, authInfo: AUTH });
    // シミュレーション API は自分が出した呼び出しではないので記録しない
    mock.simulateInboundTransferRequest("logged.xyz");
    records.length = 0;

    const message = await mock.poll();
    await mock.ackMessage(String(message?.id));

    // 対象ドメインは通知を読むまで決まらないため domainName は null（実アダプタと同じ）
    expect(records.map((r) => [r.command, r.domainName])).toEqual([
      ["poll", null],
      ["ack", null],
    ]);
  });
});

describe("MockRegistryAdapter: 移管まわりのオプションと観測（§11.1 / FR-15）", () => {
  it("registrarId / foreignRegistrarId は上書きできる（direction 導出用）", async () => {
    const mock = new MockRegistryAdapter({
      registrarId: "REG-DOPAMIN",
      foreignRegistrarId: "REG-OTHER",
    });
    expect(mock.registrarId).toBe("REG-DOPAMIN");

    const name = "direction.xyz";
    mock.seedForeignDomain(name, AUTH);
    const result = await mock.transferRequest(name, AUTH);
    expect(result.requestingRegistrarId).toBe("REG-DOPAMIN");
    expect(result.actingRegistrarId).toBe("REG-OTHER");
  });

  it("autoApproveMs で自動承認までの時間を短縮できる（§17 MOCK_TRANSFER_AUTO_APPROVE_MS）", async () => {
    const time = clock("2026-08-26T12:00:00.000Z");
    const mock = new MockRegistryAdapter({
      autoApproveMs: 1_000,
      now: time.now,
    });
    const name = "fast-auto.xyz";
    await mock.create({ name, periodYears: 1, authInfo: AUTH });
    const pending = mock.simulateInboundTransferRequest(name);
    expect(
      new Date(String(pending.actByAt)).getTime() -
        new Date(String(pending.requestedAt)).getTime(),
    ).toBe(1_000);

    time.advance(1_000);
    expect((await mock.transferQuery(name)).status).toBe("none");
  });

  it("approve / reject / cancel も操作ログに 1 レコードずつ残る（FR-15）", async () => {
    const records: RegistryCallRecord[] = [];
    const mock = new MockRegistryAdapter({
      onCall: (record) => {
        records.push(record);
      },
    });
    for (const name of ["log-approve.xyz", "log-reject.xyz"]) {
      await mock.create({ name, periodYears: 1, authInfo: AUTH });
      mock.simulateInboundTransferRequest(name);
    }
    mock.seedForeignDomain("log-cancel.xyz", AUTH);
    await mock.transferRequest("log-cancel.xyz", AUTH);
    records.length = 0;

    await mock.transferApprove("log-approve.xyz");
    await mock.transferReject("log-reject.xyz");
    await mock.transferCancel("log-cancel.xyz");

    expect(records.map((r) => [r.command, r.domainName])).toEqual([
      ["transfer_approve", "log-approve.xyz"],
      ["transfer_reject", "log-reject.xyz"],
      ["transfer_cancel", "log-cancel.xyz"],
    ]);
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

  it("failMode は poll / ack にも効く", async () => {
    const mock = new MockRegistryAdapter({ failMode: "timeout" });
    await expectRegistryError(mock.poll(), "REGISTRY_TIMEOUT");
    await expectRegistryError(mock.ackMessage("1"), "REGISTRY_TIMEOUT");
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

describe("failMode=timeout_after_write（§11.6 (d) / AC-18-2。#49）", () => {
  function adapter(): MockRegistryAdapter {
    return new MockRegistryAdapter({ failMode: "timeout_after_write" });
  }

  it("更新系は状態を変えてからタイムアウトする（届いていたことを info で照合できる）", async () => {
    const mock = adapter();

    await expect(
      mock.create({ name: "written.com", periodYears: 1, authInfo: "s3cret" }),
    ).rejects.toMatchObject({ code: "REGISTRY_TIMEOUT" });

    // failMode=timeout と違い、参照系は通るしドメインは実際に作られている
    const info = await mock.info("written.com");
    expect(info.name).toBe("written.com");
  });

  it("参照系はそのまま通る（照合できないと再現の意味が無い）", async () => {
    const mock = adapter();
    await expect(mock.hello()).resolves.toMatchObject({ registry: "mock" });
    await expect(mock.check(["free.com"])).resolves.toEqual([
      { name: "free.com", available: true },
    ]);
    await expect(mock.poll()).resolves.toBeNull();
  });

  it("renew / update / delete も反映してからタイムアウトする", async () => {
    const mock = new MockRegistryAdapter();
    const created = await mock.create({
      name: "flow.com",
      periodYears: 1,
      authInfo: "s3cret",
    });
    mock.setFailMode("timeout_after_write");

    await expect(
      mock.renew("flow.com", {
        periodYears: 1,
        currentExpiresAt: created.expiresAt ?? "",
      }),
    ).rejects.toMatchObject({ code: "REGISTRY_TIMEOUT" });
    // 期限は延びている（AC-18-2 の照合条件）
    const renewed = await mock.info("flow.com");
    expect(new Date(String(renewed.expiresAt)).getTime()).toBeGreaterThan(
      new Date(String(created.expiresAt)).getTime(),
    );

    await expect(
      mock.update("flow.com", { addNameservers: ["ns1.flow.com"] }),
    ).rejects.toMatchObject({ code: "REGISTRY_TIMEOUT" });
    expect((await mock.info("flow.com")).nameservers).toEqual(["ns1.flow.com"]);

    await expect(mock.delete("flow.com")).rejects.toMatchObject({
      code: "REGISTRY_TIMEOUT",
    });
    expect((await mock.info("flow.com")).rgpStatuses).toContain(
      "redemptionPeriod",
    );
  });

  it("移管申請も受理してからタイムアウトする", async () => {
    const mock = new MockRegistryAdapter();
    mock.seedForeignDomain("move.com", "auth-move");
    mock.setFailMode("timeout_after_write");

    await expect(
      mock.transferRequest("move.com", "auth-move"),
    ).rejects.toMatchObject({ code: "REGISTRY_TIMEOUT" });

    // transferQuery（参照系）で受理済みを確認できる
    expect((await mock.transferQuery("move.com")).status).toBe("pending");
  });

  it("failMode=timeout は手前で落ちるので状態が変わらない（対比）", async () => {
    const mock = new MockRegistryAdapter({ failMode: "timeout" });
    await expect(
      mock.create({ name: "lost.com", periodYears: 1, authInfo: "s3cret" }),
    ).rejects.toMatchObject({ code: "REGISTRY_TIMEOUT" });

    mock.setFailMode("none");
    await expect(mock.info("lost.com")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("MockRegistryAdapter: seedOwnedDomain（FR-16 のデモ投入）", () => {
  it("自レジストラ保有として投入され、そのまま操作できる", async () => {
    const mock = new MockRegistryAdapter();
    mock.seedOwnedDomain("demo-owned.com", {
      nameservers: ["ns1.example.com", "ns2.example.com"],
    });

    const info = await mock.info("demo-owned.com");
    expect(info.statuses).toEqual(["ok"]);
    expect(info.nameservers).toEqual(["ns1.example.com", "ns2.example.com"]);
    // 自レジストラ保有なので更新系が通る（相手レジストラ保有だと拒否される）
    const renewed = await mock.renew("demo-owned.com", {
      periodYears: 1,
      currentExpiresAt: info.expiresAt ?? "",
    });
    expect(new Date(renewed.expiresAt ?? 0).getTime()).toBeGreaterThan(
      new Date(info.expiresAt ?? 0).getTime(),
    );
  });

  it("registeredAt を過去にすると有効期限が近い状態を作れる", async () => {
    const mock = new MockRegistryAdapter();
    const registeredAt = new Date(
      Date.now() - 345 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const info = mock.seedOwnedDomain("demo-expiring.com", { registeredAt });

    const daysLeft =
      (new Date(info.expiresAt ?? 0).getTime() - Date.now()) /
      (24 * 60 * 60 * 1000);
    expect(daysLeft).toBeGreaterThan(18);
    expect(daysLeft).toBeLessThan(22);
  });

  it("RGP 中（redemptionPeriod + pendingDelete）を作れて復旧できる", async () => {
    const mock = new MockRegistryAdapter();
    mock.seedOwnedDomain("demo-rgp.com", {
      nameservers: ["ns1.example.com"],
      rgpStatuses: ["redemptionPeriod"],
      pendingDelete: true,
    });

    const info = await mock.info("demo-rgp.com");
    expect(info.rgpStatuses).toEqual(["redemptionPeriod"]);
    expect(info.statuses).toEqual(["pendingDelete", "redemptionPeriod"]);

    const restored = await mock.restore("demo-rgp.com");
    expect(restored.rgpStatuses).not.toContain("redemptionPeriod");
  });

  it("NS を省略すると inactive になる", () => {
    const mock = new MockRegistryAdapter();
    expect(mock.seedOwnedDomain("demo-inactive.com").statuses).toEqual([
      "inactive",
    ]);
  });

  it("同じ名前を 2 回投入すると CONFLICT", () => {
    const mock = new MockRegistryAdapter();
    mock.seedOwnedDomain("demo-dup.com");
    expect(() => mock.seedOwnedDomain("demo-dup.com")).toThrowError(
      RegistryError,
    );
  });

  it("シード自体は操作ログを発行しない（レジストリ操作ではない）", async () => {
    const calls: RegistryCallRecord[] = [];
    const mock = new MockRegistryAdapter({
      onCall: (record) => {
        calls.push(record);
        return Promise.resolve();
      },
    });
    mock.seedOwnedDomain("demo-log.com");
    expect(calls).toHaveLength(0);

    await mock.info("demo-log.com");
    expect(calls.map((c) => c.command)).toEqual(["info"]);
  });
});
