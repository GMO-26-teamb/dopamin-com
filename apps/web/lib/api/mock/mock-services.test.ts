import { beforeEach, describe, expect, it } from "vitest";
import { ApiClientError } from "../errors";
import type { Services } from "../services";
import { createMockServices, resetMockStore } from "./mock-services";

/** テストでは遅延を 0 にして即時解決させる。 */
function services(
  scenario: Parameters<typeof createMockServices>[0],
): Services {
  return createMockServices(scenario, { delayMs: 0 });
}

/** 受信済み（direction=out / pending）の移管を 1 件取り出す。 */
async function receivedTransfer(api: Services) {
  const [received] = (await api.transfers.list()).filter(
    (t) => t.direction === "out" && t.status === "pending",
  );
  if (!received) {
    throw new Error("受信した移管申請が見つかりません");
  }
  return received;
}

beforeEach(() => {
  resetMockStore();
});

describe("createMockServices - domains", () => {
  it("default シナリオは 4 件を fixtures の状態で返す", async () => {
    const list = await services("default").domains.list();

    expect(list.map((d) => d.name)).toEqual([
      "takutaku.com",
      "harupika.xyz",
      "demo-app.online",
      "tkt-lab.net",
    ]);
    expect(list.map((d) => d.displayStatus)).toEqual([
      "active",
      "active",
      "rgp",
      "transfer_out_pending",
    ]);
  });

  it("移管済みドメインは保有一覧に出さない（AC-02-4）", async () => {
    const list = await services("default").domains.list();
    expect(list.some((d) => d.name === "old-blog.xyz")).toBe(false);

    const detail = await services("default").domains.get("old-blog.xyz");
    expect(detail.displayStatus).toBe("transferred_out");
  });

  it("empty シナリオは空配列を返す", async () => {
    await expect(services("empty").domains.list()).resolves.toEqual([]);
  });

  it("error シナリオは REGISTRY_UNAVAILABLE の ApiClientError を投げる", async () => {
    const error = await services("error")
      .domains.list()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("REGISTRY_UNAVAILABLE");
  });

  it("一覧は stale を立てない（DB キャッシュを読むだけで同期を試みない）", async () => {
    const list = await services("stale").domains.list();
    expect(list.every((d) => !d.stale)).toBe(true);
  });

  it("stale シナリオの sync は kitaqsign だけ落ちた部分失敗を返す（S-13 / AC-18-1）", async () => {
    const { domains, failures } = await services("stale").domains.sync();

    const down = domains.filter((d) => d.stale).map((d) => d.name);
    const alive = domains.filter((d) => !d.stale);

    // 落ちた側だけ stale。もう一方は最新化できている = 部分縮退が画面に出せる
    expect(down).toEqual(["takutaku.com", "tkt-lab.net"]);
    expect(alive.every((d) => d.registry === "kitaqnic")).toBe(true);
    expect(alive.length).toBeGreaterThan(0);

    expect(failures.map((f) => f.name)).toEqual(down);
    expect(failures.every((f) => f.registry === "kitaqsign")).toBe(true);
  });

  it("失敗が無いシナリオの sync は failures が空", async () => {
    const { failures } = await services("default").domains.sync();
    expect(failures).toEqual([]);
  });

  it("update は移管ロックの付与・解除を反映する（D-02 のトグル・#205）", async () => {
    const api = services("default");

    const locked = await api.domains.update("takutaku.com", {
      clientStatuses: { add: ["clientTransferProhibited"] },
    });
    expect(locked.statuses).toContain("clientTransferProhibited");

    const unlocked = await api.domains.update("takutaku.com", {
      clientStatuses: { remove: ["clientTransferProhibited"] },
    });
    expect(unlocked.statuses).not.toContain("clientTransferProhibited");
  });

  it("update は渡されなかった項目を変えない（NS・登録者・ロック）", async () => {
    const api = services("default");
    const before = await api.domains.get("takutaku.com");

    const after = await api.domains.update("takutaku.com", {
      clientStatuses: { add: ["clientTransferProhibited"] },
    });

    expect(after.nameservers).toEqual(before.nameservers);
    expect(after.registrant).toEqual(before.registrant);
  });
});

describe("createMockServices - subdomains", () => {
  it("apply 後は全ホストが applied になる", async () => {
    const api = services("default");

    const before = await api.subdomains.get("takutaku.com");
    expect(before?.hosts.map((h) => h.applyStatus)).not.toEqual([
      "applied",
      "applied",
      "applied",
      "applied",
    ]);

    const result = await api.subdomains.apply("takutaku.com");

    expect(result.plan.hosts).toHaveLength(4);
    expect(result.plan.hosts.every((h) => h.applyStatus === "applied")).toBe(
      true,
    );
    expect(result.nameserversChanged).toBe(true);

    const after = await api.subdomains.get("takutaku.com");
    expect(after?.hosts.every((h) => h.applyStatus === "applied")).toBe(true);
  });

  it("save 後は変更したホストだけが changed になる", async () => {
    const api = services("default");
    await api.subdomains.apply("takutaku.com");

    const plan = await api.subdomains.get("takutaku.com");
    if (!plan) {
      throw new Error("設計が見つかりません");
    }
    const [first, ...rest] = plan.hosts;
    if (!first) {
      throw new Error("ホストが見つかりません");
    }
    const saved = await api.subdomains.save("takutaku.com", {
      ...plan,
      hosts: [{ ...first, target: "203.0.113.99" }, ...rest],
    });

    expect(saved.hosts[0]?.applyStatus).toBe("changed");
    expect(saved.hosts.slice(1).every((h) => h.applyStatus === "applied")).toBe(
      true,
    );
  });

  it("設計が無いドメインは null を返す（S-40）", async () => {
    await expect(
      services("default").subdomains.get("harupika.xyz"),
    ).resolves.toBeNull();
  });

  it("ns-fail シナリオは NS を切り替えずレコードも変更しない（S-46）", async () => {
    const api = services("ns-fail");
    const result = await api.subdomains.apply("takutaku.com");

    expect(result.nameserversChanged).toBe(false);
    expect(result.plan.nameserversSwitched).toBe(false);
    expect(result.added + result.updated + result.removed).toBe(0);
    expect(result.plan.hosts.every((h) => h.applyStatus === "applied")).toBe(
      false,
    );
  });
});

describe("createMockServices - candidates", () => {
  it("候補を 6 件、重複なしで返す", async () => {
    const candidates = await services("default").candidates.generate({
      nickname: "たくたく",
    });

    expect(candidates).toHaveLength(6);
    const names = candidates.map((c) => `${c.sld}.${c.tld}`);
    expect(new Set(names).size).toBe(6);
  });

  it("exclude に渡した候補は返さない", async () => {
    const api = services("default");
    const first = await api.candidates.generate({ nickname: "たくたく" });
    const firstName = `${first[0]?.sld}.${first[0]?.tld}`;

    const second = await api.candidates.generate({
      nickname: "たくたく",
      exclude: [firstName],
    });

    expect(second).toHaveLength(6);
    expect(second.map((c) => `${c.sld}.${c.tld}`)).not.toContain(firstName);
  });

  it("ai-timeout シナリオは REGISTRY_TIMEOUT を投げる（S-23）", async () => {
    const error = await services("ai-timeout")
      .candidates.generate({ nickname: "たくたく" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("REGISTRY_TIMEOUT");
    // レジストリではなく AI の文言を出すための目印（S-23）
    expect((error as ApiClientError).origin).toBe("ai");
  });

  it("AI の失敗には origin=ai が付く（候補生成 / サブドメイン提案）", async () => {
    const unavailable = await services("error")
      .candidates.generate({ nickname: "たくたく" })
      .catch((e: unknown) => e);
    expect((unavailable as ApiClientError).code).toBe("AI_UNAVAILABLE");
    expect((unavailable as ApiClientError).origin).toBe("ai");

    const timeout = await services("ai-timeout")
      .subdomains.propose("takutaku.com", {})
      .catch((e: unknown) => e);
    expect((timeout as ApiClientError).code).toBe("REGISTRY_TIMEOUT");
    expect((timeout as ApiClientError).origin).toBe("ai");
  });

  it("レジストリの失敗には origin を付けない（従来どおりの文言）", async () => {
    const error = await services("error")
      .domains.register({ name: "example-app.com", period: 1 })
      .catch((e: unknown) => e);

    expect((error as ApiClientError).code).toBe("REGISTRY_TIMEOUT");
    expect((error as ApiClientError).origin).toBeUndefined();
  });
});

describe("createMockServices - transfers", () => {
  it("誤った AuthCode は REGISTRY_REJECTED（2202）で拒否する（S-52）", async () => {
    const error = await services("default")
      .transfers.request({ name: "example-app.com", authCode: "bad" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("REGISTRY_REJECTED");
    expect((error as ApiClientError).registryCode).toBe("2202");
  });

  it("正しい AuthCode は pending の申請を作り一覧に載せる", async () => {
    const api = services("default");
    const before = await api.transfers.list();

    const transfer = await api.transfers.request({
      name: "example-app.com",
      authCode: "GOOD-AUTH-CODE",
    });
    expect(transfer.direction).toBe("in");
    expect(transfer.status).toBe("pending");

    const after = await api.transfers.list();
    expect(after).toHaveLength(before.length + 1);
  });

  it("拒否した申請は rejected になり、ドメインは保有のまま残る", async () => {
    const api = services("default");
    const received = await receivedTransfer(api);

    await expect(api.transfers.reject(received.id)).resolves.toMatchObject({
      status: "rejected",
    });
    const domain = await api.domains.get(received.domainName);
    expect(domain.displayStatus).toBe("active");
  });

  it("承認した OUT は移管済みになり保有一覧から消える（AC-02-4）", async () => {
    const api = services("default");
    const received = await receivedTransfer(api);

    await expect(api.transfers.approve(received.id)).resolves.toMatchObject({
      status: "approved",
    });
    const domain = await api.domains.get(received.domainName);
    expect(domain.displayStatus).toBe("transferred_out");
    const list = await api.domains.list();
    expect(list.some((d) => d.name === received.domainName)).toBe(false);
  });
});

describe("createMockServices - その他", () => {
  it("unsupported シナリオは WebAuthn 非対応として扱う（S-01c / S-02c）", () => {
    expect(services("unsupported").auth.isSupported()).toBe(false);
    expect(services("default").auth.isSupported()).toBe(true);
  });

  it("empty シナリオはログ・移管も 0 件にする", async () => {
    const api = services("empty");
    await expect(api.transfers.list()).resolves.toEqual([]);
    await expect(api.logs.operations()).resolves.toEqual([]);
    await expect(api.logs.ai()).resolves.toEqual([]);
  });

  it("conflict シナリオの登録は CONFLICT（S-27）", async () => {
    const error = await services("conflict")
      .domains.register({ name: "example-app.com", period: 1 })
      .catch((e: unknown) => e);

    expect((error as ApiClientError).code).toBe("CONFLICT");
  });

  it("error シナリオの登録は REGISTRY_TIMEOUT（S-28）", async () => {
    const error = await services("error")
      .domains.register({ name: "example-app.com", period: 1 })
      .catch((e: unknown) => e);

    expect((error as ApiClientError).code).toBe("REGISTRY_TIMEOUT");
  });

  it("類似度は 0〜1 で返る（SimilarityRow / API の topSimilar と同じ単位）", async () => {
    const results = await services("default").domains.check({
      sld: "example-app",
      tlds: ["com", "xyz"],
    });
    const nearest = results.flatMap((r) => r.uniqueness?.nearest ?? []);

    expect(nearest.length).toBeGreaterThan(0);
    for (const entry of nearest) {
      expect(entry.similarity).toBeGreaterThan(0);
      expect(entry.similarity).toBeLessThanOrEqual(1);
    }
  });

  it("候補 fixtures の類似度も 0〜1", async () => {
    const candidates = await services("default").candidates.generate({
      nickname: "takutaku",
    });
    const nearest = candidates.flatMap((c) => c.uniqueness?.nearest ?? []);

    expect(nearest.length).toBeGreaterThan(0);
    for (const entry of nearest) {
      expect(entry.similarity).toBeGreaterThan(0);
      expect(entry.similarity).toBeLessThanOrEqual(1);
    }
  });

  it("partial-failure シナリオの check は確認不可の行を含む（AC-03-2）", async () => {
    const results = await services("partial-failure").domains.check({
      sld: "example-app",
      tlds: ["com", "xyz"],
    });

    expect(results.some((r) => r.availability === "error")).toBe(true);
    expect(results.some((r) => r.availability !== "error")).toBe(true);
  });

  it("me / パスキーは常に取得できる（AppShell が描画できる）", async () => {
    for (const scenario of ["default", "error", "empty"] as const) {
      const me = await services(scenario).settings.me();
      expect(me.user.displayName).not.toBe("");
    }
    await expect(services("default").auth.listPasskeys()).resolves.toHaveLength(
      2,
    );
  });

  it("renamePasskey は store に反映され、listPasskeys で新しい名前が読める", async () => {
    const api = services("default");
    const renamed = await api.auth.renamePasskey(
      "pk_01HZY0000000000000000001",
      "仕事用 MacBook",
    );

    expect(renamed).toMatchObject({
      id: "pk_01HZY0000000000000000001",
      name: "仕事用 MacBook",
      deviceType: "multiDevice",
    });
    const list = await api.auth.listPasskeys();
    expect(list.map((p) => p.name)).toEqual(["仕事用 MacBook", "iPhone"]);
  });

  it("renamePasskey は前後の空白を除去し、0・33 文字は VALIDATION_ERROR", async () => {
    const api = services("default");
    await expect(
      api.auth.renamePasskey("pk_01HZY0000000000000000002", "  自宅  "),
    ).resolves.toMatchObject({ name: "自宅" });

    const tooLong = await api.auth
      .renamePasskey("pk_01HZY0000000000000000002", "あ".repeat(33))
      .catch((e: unknown) => e);
    expect(tooLong).toBeInstanceOf(ApiClientError);
    expect((tooLong as ApiClientError).code).toBe("VALIDATION_ERROR");
  });

  it("renamePasskey は不在なら NOT_FOUND、error シナリオなら INTERNAL", async () => {
    const missing = await services("default")
      .auth.renamePasskey("pk_nope", "x")
      .catch((e: unknown) => e);
    expect((missing as ApiClientError).code).toBe("NOT_FOUND");

    const failed = await services("error")
      .auth.renamePasskey("pk_01HZY0000000000000000001", "x")
      .catch((e: unknown) => e);
    expect((failed as ApiClientError).code).toBe("INTERNAL");
  });

  it("resetMockStore で store の変更が巻き戻る", async () => {
    const api = services("default");
    await api.subdomains.apply("takutaku.com");
    resetMockStore();

    const plan = await api.subdomains.get("takutaku.com");
    expect(plan?.hosts.every((h) => h.applyStatus === "applied")).toBe(false);
  });
});
