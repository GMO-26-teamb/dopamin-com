import { describe, expect, it } from "vitest";
import { MockRegistryAdapter } from "./mock";
import { createInMemoryMockStore, type MockStateStore } from "./mock-store";

/**
 * mock の状態の永続化（docs/requirements.md §11.1 / §16.1。#46）。
 *
 * 「別インスタンスから見える」ことが要件なので、毎回新しいアダプタを作って
 * 同じストアを渡す（Vercel Functions のインスタンス跨ぎ・コールドスタートの再現）。
 */

function adapterOn(store: MockStateStore): MockRegistryAdapter {
  return new MockRegistryAdapter({ id: "mock", store });
}

describe("MockRegistryAdapter + MockStateStore", () => {
  it("受け入れ条件: create したドメインを別インスタンスの info が引ける", async () => {
    const store = createInMemoryMockStore();
    await adapterOn(store).create({
      name: "persist.com",
      periodYears: 1,
      authInfo: "s3cret",
    });

    // ここでプロセスが入れ替わった、という想定
    const info = await adapterOn(store).info("persist.com");
    expect(info.name).toBe("persist.com");
    expect(info.statuses).toContain("inactive");
  });

  it("更新も引き継ぐ（NS 追加 → 別インスタンスで反映済み）", async () => {
    const store = createInMemoryMockStore();
    await adapterOn(store).create({
      name: "update.com",
      periodYears: 1,
      authInfo: "s3cret",
    });
    await adapterOn(store).update("update.com", {
      addNameservers: ["ns1.update.com", "ns2.update.com"],
    });

    const info = await adapterOn(store).info("update.com");
    expect(info.nameservers).toEqual(["ns1.update.com", "ns2.update.com"]);
    expect(info.statuses).not.toContain("inactive");
  });

  it("Poll キューとメッセージ ID の採番も引き継ぐ", async () => {
    const store = createInMemoryMockStore();
    const seeded = adapterOn(store);
    await seeded.create({
      name: "poll.com",
      periodYears: 1,
      authInfo: "s3cret",
    });
    // シミュレーション API は同期なので、明示的に書き戻す
    seeded.simulateInboundTransferRequest("poll.com");
    await seeded.persist();

    const first = await adapterOn(store).poll();
    expect(first).toMatchObject({
      type: "transfer_request",
      domainName: "poll.com",
    });

    // ack も別インスタンスから効く（同じ通知が返り続けない）
    await adapterOn(store).ackMessage(String(first?.id));
    expect(await adapterOn(store).poll()).toBeNull();
  });

  it("コンタクトも引き継ぐ（#72 の再利用が別インスタンスで壊れない）", async () => {
    const store = createInMemoryMockStore();
    const id = await adapterOn(store).createContact({
      name: "Taro Test",
      email: "taro.test@example.com",
      street: "N/A",
      city: "N/A",
      countryCode: "JP",
    });

    await adapterOn(store).updateContact(id, {
      name: "Hanako Test",
      email: "hanako.test@example.org",
      street: "Redacted for Privacy",
      city: "Redacted for Privacy",
      countryCode: "US",
    });
    expect(adapterOn(store).peekContact(id)).toBeUndefined();

    const reloaded = adapterOn(store);
    await reloaded.hydrate();
    expect(reloaded.peekContact(id)?.name).toBe("Hanako Test");
  });

  it("失敗しても途中まで変わった状態は書き戻す", async () => {
    const store = createInMemoryMockStore();
    const adapter = adapterOn(store);
    await adapter.create({
      name: "dup.com",
      periodYears: 1,
      authInfo: "s3cret",
    });
    // 2 回目は CONFLICT。1 回目の状態は残っていなければならない
    await expect(
      adapterOn(store).create({
        name: "dup.com",
        periodYears: 1,
        authInfo: "s3cret",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect((await adapterOn(store).info("dup.com")).name).toBe("dup.com");
  });

  it("ストアを渡さなければ従来どおりプロセス内に閉じる", async () => {
    const first = new MockRegistryAdapter({ id: "mock" });
    await first.create({
      name: "local.com",
      periodYears: 1,
      authInfo: "s3cret",
    });

    // 別インスタンスからは見えない（永続化していないため）
    const second = new MockRegistryAdapter({ id: "mock" });
    await expect(second.info("local.com")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("ストアが空でも起動できる", async () => {
    const store = createInMemoryMockStore();
    expect(await store.load()).toBeNull();
    await expect(adapterOn(store).check(["nothing.com"])).resolves.toEqual([
      { name: "nothing.com", available: true },
    ]);
  });

  it("書き込みの persist 前に同一インスタンスで並行リクエストが走っても書き込みが失われない", async () => {
    const store = createInMemoryMockStore();

    // onCall（操作ログ書き込み相当）の await 中に別リクエストが割り込む状況を再現する。
    // 最初の create の emit だけを止め、その間に参照系の hydrate を走らせる
    let releaseCreateEmit = (): void => {};
    const createEmitGate = new Promise<void>((resolve) => {
      releaseCreateEmit = resolve;
    });
    let createEmitted = false;
    const adapter = new MockRegistryAdapter({
      id: "mock",
      store,
      onCall: async (record) => {
        if (record.command === "create" && !createEmitted) {
          createEmitted = true;
          await createEmitGate;
        }
      },
    });

    const creating = adapter.create({
      name: "lost.com",
      periodYears: 1,
      authInfo: "s3cret",
    });
    // create が emit で止まるところまで進める
    await new Promise((resolve) => setTimeout(resolve, 0));
    // 同じインスタンスへの並行リクエスト（/health の hello など参照系でよい）
    const reading = adapter.hello();
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseCreateEmit();
    await creating;
    await reading;

    // 成功応答を返した create は、別インスタンス（= 次のリクエスト）から見えなければならない
    await expect(adapterOn(store).info("lost.com")).resolves.toMatchObject({
      name: "lost.com",
    });
  });

  it("状態を変えない参照系は書き戻さない（/health のたびに書かない）", async () => {
    const store = createInMemoryMockStore();
    let saves = 0;
    const counting = {
      load: () => store.load(),
      save: (snapshot: Parameters<MockStateStore["save"]>[0]) => {
        saves += 1;
        return store.save(snapshot);
      },
    };

    await new MockRegistryAdapter({ id: "mock", store: counting }).create({
      name: "written.com",
      periodYears: 1,
      authInfo: "s3cret",
    });
    expect(saves).toBe(1);

    // 参照系は状態を変えないので書き込みが増えない
    const reader = new MockRegistryAdapter({ id: "mock", store: counting });
    await reader.hello();
    await reader.check(["written.com"]);
    await reader.info("written.com");
    await reader.poll();
    expect(saves).toBe(1);
  });
});
