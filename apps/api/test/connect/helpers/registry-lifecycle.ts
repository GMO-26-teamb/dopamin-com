import type { KitaqAdapterConfig } from "@dopamin/registry";
import { createKitaqAdapter, RegistryError } from "@dopamin/registry";
import { afterAll, expect, it } from "vitest";
import { uniqueDomainName } from "./connect";

/** 1 ステップあたりのタイムアウト。実レジストリの応答遅延を考慮して長めに取る。 */
const STEP = { timeout: 30_000 } as const;
/** 複数リクエストを直列に行うステップ（create のコンタクト作成、update のホスト自動作成）用。 */
const MULTI_STEP = { timeout: 60_000 } as const;

/**
 * 実レジストリに対するフルライフサイクル疎通テスト（kitaqsign / kitaqnic 共通）。
 *
 * 検証内容: hello → check → create（コンタクト作成込み）→ info → renew →
 * update（NS / クライアントステータス）→ authCode → transfer（誤 AuthCode 拒否）→
 * delete → restore → 最終 delete。
 *
 * ⚠️ 更新系コマンドは実データに反映される。テスト用ドメインは実行ごとに一意な
 * `dopamin-t*` 名で登録し、最後に削除して RGP（復旧猶予）に落として終える。
 */
export function registryLifecycleSuite(
  config: KitaqAdapterConfig,
  tld: string,
): void {
  const adapter = createKitaqAdapter(config);
  const domainName = uniqueDomainName(tld);
  // ドメイン配下のホスト名にする（対象 TLD 外のホストはレジストリが作成を拒否しうるため）。
  // ホストオブジェクトはアダプタの ensureHosts が自動作成する。
  const nameservers = [`ns1.${domainName}`, `ns2.${domainName}`];
  let expiresAtAfterCreate: string | null = null;
  let created = false;
  let cleanedUp = false;

  // 途中のステップが失敗・中断されても、登録済みドメインを可能な限り削除して終える。
  // 削除に失敗した場合（pendingTransfer 等）は実レジストリにドメインが残るため、
  // 黙って握りつぶさず必ずドメイン名付きで警告して手動対応につなげる。
  afterAll(async () => {
    if (!created || cleanedUp) {
      return;
    }
    try {
      await adapter.delete(domainName);
    } catch (err) {
      const detail =
        err instanceof RegistryError
          ? `${err.code}（registryCode=${err.registryCode ?? "-"}）`
          : String(err);
      console.warn(
        `[connect-test] クリーンアップの delete に失敗しました。${config.id} に ${domainName} が残っている可能性があります（手動で削除してください）: ${detail}`,
      );
    }
  }, 30_000);

  it(`hello: ${config.id} に 2 段認証付きで疎通できる`, STEP, async () => {
    const hello = await adapter.hello();
    expect(hello.registry).toBe(config.id);
    expect(hello.tlds).toContain(tld);
  });

  it(`check: 未登録の ${domainName} が空きと判定される`, STEP, async () => {
    const results = await adapter.check([domainName]);
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe(domainName);
    expect(results[0]?.available).toBe(true);
  });

  it(
    "create: コンタクト作成込みでドメインを登録できる",
    MULTI_STEP,
    async () => {
      const info = await adapter.create({
        name: domainName,
        periodYears: 1,
        authInfo: `connect-test-${Math.random().toString(36).slice(2, 10)}`,
      });
      created = true;
      expect(info.name).toBe(domainName);
      expect(info.registry).toBe(config.id);
      expect(info.registeredAt).toBeTruthy();
      expect(info.expiresAt).toBeTruthy();
      expect(info.statuses.length).toBeGreaterThan(0);
      expiresAtAfterCreate = info.expiresAt;
    },
  );

  it("check: 登録済みになったため空きでなくなる", STEP, async () => {
    const results = await adapter.check([domainName]);
    expect(results[0]?.available).toBe(false);
  });

  it("info: 登録内容を参照できる", STEP, async () => {
    const info = await adapter.info(domainName);
    expect(info.name).toBe(domainName);
    expect(info.registrant).toBeTruthy();
    expect(info.nameservers).toEqual([]);
  });

  it("renew: 有効期限を 1 年延長できる", STEP, async () => {
    const before = expiresAtAfterCreate;
    if (!before) {
      throw new Error(
        "create ステップが失敗しているため renew を検証できません",
      );
    }
    const info = await adapter.renew(domainName, {
      periodYears: 1,
      currentExpiresAt: before,
    });
    if (!info.expiresAt) {
      throw new Error("renew 後の expiresAt がありません");
    }
    expect(new Date(info.expiresAt).getTime()).toBeGreaterThan(
      new Date(before).getTime(),
    );
  });

  it(
    "update: ネームサーバを設定できる（ホスト自動作成込み）",
    MULTI_STEP,
    async () => {
      const info = await adapter.update(domainName, {
        addNameservers: nameservers,
      });
      expect(info.nameservers).toEqual(expect.arrayContaining(nameservers));
      expect(info.statuses).not.toContain("inactive");
    },
  );

  it(
    "update: クライアントステータスの付与・解除コマンドが受理される",
    // update → info 再取得が 2 往復になる（kitaqnic は update 応答が空）ため MULTI_STEP
    MULTI_STEP,
    async () => {
      // 実測（2026-08-25・両レジストリ）: add.statuses は result 1000 を返すが status には反映されない
      // （docs/registry/spec-notes.md【要確認】10）。ここでは疎通（コマンドが受理されること）を確認し、
      // 反映されるようになったら解除まで検証して知らせる。
      const locked = await adapter.update(domainName, {
        addStatuses: ["clientTransferProhibited"],
      });
      if (locked.statuses.includes("clientTransferProhibited")) {
        console.warn(
          `[connect] ${config.id}: add.statuses が反映されるようになっています。` +
            "spec-notes の【要確認】10 を解決し、このテストを固定アサーションに更新してください。",
        );
      }
      const unlocked = await adapter.update(domainName, {
        removeStatuses: ["clientTransferProhibited"],
      });
      expect(unlocked.statuses).not.toContain("clientTransferProhibited");
    },
  );

  it("authCode: rotate-auth-info で AuthCode を取得できる", STEP, async () => {
    const authCode = await adapter.authCode(domainName);
    expect(authCode.length).toBeGreaterThan(0);
    expect(authCode.length).toBeLessThanOrEqual(64);
  });

  it(
    "transfer: 誤った AuthCode の移管申請はレジストリに拒否される",
    STEP,
    async () => {
      // 自レジストラ保有ドメインに誤 authInfo で申請 → 必ず拒否される（2202 等）。
      // エンドポイントまで到達し、レジストリの業務拒否として正規化されることを確認する。
      const err = await adapter
        .transferRequest(domainName, "wrong-auth-info-for-test")
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(err).toBeInstanceOf(RegistryError);
      if (!(err instanceof RegistryError)) {
        throw new Error("unreachable");
      }
      // 接続断（UNAVAILABLE/TIMEOUT）やパス誤り（NOT_FOUND/SPEC_MISMATCH）では合格させない。
      // 業務拒否ならレジストリの result code が付いているはず。
      expect(["REGISTRY_REJECTED", "OPERATION_NOT_ALLOWED"]).toContain(
        err.code,
      );
      expect(err.registryCode).toBeDefined();

      // 万一受理されると以降の delete がブロックされるため、ここで検知する
      const info = await adapter.info(domainName);
      expect(info.statuses).not.toContain("pendingTransfer");
    },
  );

  it("delete: 廃止すると復旧猶予（RGP）に入る", STEP, async () => {
    await adapter.delete(domainName);
    const info = await adapter.info(domainName);
    const inRgp =
      info.rgpStatuses.includes("redemptionPeriod") ||
      info.statuses.includes("pendingDelete");
    expect(inRgp).toBe(true);
  });

  it("restore: RGP から復旧できる", STEP, async () => {
    const info = await adapter.restore(domainName);
    expect(info.statuses).not.toContain("pendingDelete");
    expect(info.rgpStatuses).not.toContain("redemptionPeriod");
  });

  it("cleanup: テスト用ドメインを最終削除する", STEP, async () => {
    await adapter.delete(domainName);
    cleanedUp = true;
    const info = await adapter.info(domainName);
    const inRgp =
      info.rgpStatuses.includes("redemptionPeriod") ||
      info.statuses.includes("pendingDelete");
    expect(inRgp).toBe(true);
  });
}
