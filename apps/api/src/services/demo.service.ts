import { randomBytes } from "node:crypto";
import {
  clearDemoData,
  type Db,
  DEMO_EXPIRING_IN_DAYS,
  DEMO_REDEMPTION_DAYS,
  DEMO_SCENARIOS,
  type DemoScenario,
  demoDomainName,
  demoSuffix,
  listDemoDomainNames,
} from "@dopamin/db";
import { MockRegistryAdapter, RegistryError } from "@dopamin/registry";
import type { AuthUser, DemoResetResponse } from "@dopamin/shared";
import { getDb } from "../lib/db";
import { ApiException } from "../lib/errors";
import { adapterForDomain } from "../lib/registries";
import { upsertDomainFromInfo } from "./domain.service";
import { setDomainRgpUntil } from "./domain-store";
import {
  recordInboundTransferRequest,
  recordOutboundTransferRequest,
} from "./transfer.service";

/**
 * デモデータリセット（docs/requirements.md FR-16 / §10.1 `POST /demo/reset`）。
 *
 * ユーザーのドメイン・設計・ログを消してから、mock レジストリに 5 つの状態
 * （Active / RGP / 期限間近 / 移管 IN 申請中 / 受信した移管 OUT 申請）を作り直す。
 *
 * **投入先は mock 固定**。実レジストリへの実登録は【要確認 §21.2 #7】
 * （テスト用ドメインの削除・再利用制約）が解けるまで行わない。
 * 移管中の 2 件は 20 分でサーバ自動承認されるため、そもそも実レジストリでは維持できない。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** デモ用ドメインに設定するネームサーバ（空だと `inactive` になり Active に見えない）。 */
const DEMO_NAMESERVERS = [
  "ns1.dopamin-demo.invalid",
  "ns2.dopamin-demo.invalid",
];

/**
 * mock アダプタを取り出す。`REGISTRY_MODE=real` の環境では投入できないので明示的に落とす
 * （黙って実レジストリに `dopamin-demo-*` を登録しにいく方が危ない）。
 */
function requireMockAdapter(name: string): MockRegistryAdapter {
  const adapter = adapterForDomain(name);
  if (!(adapter instanceof MockRegistryAdapter)) {
    throw new ApiException(
      "OPERATION_NOT_ALLOWED",
      "デモデータの投入は mock レジストリ（REGISTRY_MODE=mock）でのみ実行できます。",
    );
  }
  return adapter;
}

/** 前回のデモ用ドメインを mock から消す（同じ名前で作り直せるようにする）。 */
async function clearMockDomains(
  adapter: MockRegistryAdapter,
  names: readonly string[],
): Promise<void> {
  for (const name of names) {
    try {
      await adapter.delete(name);
    } catch (error) {
      // 既に消えている / 相手レジストラ保有で消せない場合は無視する。
      // レジストリ側の掃除は best-effort で、DB のリセット自体は成立させる
      if (!(error instanceof RegistryError)) {
        throw error;
      }
    }
  }
}

/**
 * シナリオ 1 件ぶんを mock に用意し、DB に取り込む。
 *
 * `seedOwnedDomain` / `seedForeignDomain` / `simulate*` は同期 API で自動では
 * 永続化されない。ストアを使う構成（#46）では続く `info` などが `hydrate()` で
 * DB から状態を読み直すので、**書き戻す前に**呼ぶと投入したドメインが消える。
 * そのため各シード直後に `persist()` を挟む（mock.ts の persist の注意書き）。
 */
async function seedScenario(
  db: Db,
  user: AuthUser,
  adapter: MockRegistryAdapter,
  scenario: DemoScenario,
  name: string,
  now: Date,
): Promise<void> {
  switch (scenario) {
    case "active": {
      adapter.seedOwnedDomain(name, {
        registeredAt: new Date(now.getTime() - 90 * DAY_MS).toISOString(),
        nameservers: DEMO_NAMESERVERS,
      });
      await adapter.persist();
      await upsertDomainFromInfo(user.id, await adapter.info(name), now);
      return;
    }
    case "expiring": {
      // 1 年前の 20 日前に登録 = 有効期限が 20 日後（§11.4 の期限警告に掛かる）
      adapter.seedOwnedDomain(name, {
        registeredAt: new Date(
          now.getTime() - (365 - DEMO_EXPIRING_IN_DAYS) * DAY_MS,
        ).toISOString(),
        nameservers: DEMO_NAMESERVERS,
      });
      await adapter.persist();
      await upsertDomainFromInfo(user.id, await adapter.info(name), now);
      return;
    }
    case "rgp": {
      adapter.seedOwnedDomain(name, {
        registeredAt: new Date(now.getTime() - 400 * DAY_MS).toISOString(),
        nameservers: DEMO_NAMESERVERS,
        rgpStatuses: ["redemptionPeriod"],
        pendingDelete: true,
      });
      await adapter.persist();
      const record = await upsertDomainFromInfo(
        user.id,
        await adapter.info(name),
        now,
      );
      // `rgp_until` はレジストリの info が返さないので、§11.4 の目安（30 日）で補う。
      // 画面が「残日数」を出せるようにするためのデモ用の値
      if (record.id !== null) {
        await setDomainRgpUntil(
          db,
          record.id,
          new Date(now.getTime() + DEMO_REDEMPTION_DAYS * DAY_MS),
        );
      }
      return;
    }
    case "transfer-in": {
      // 移管 IN は相手レジストラ保有のドメインから始まる（自分から自分へは移管できない）
      const authCode = randomBytes(12).toString("base64url");
      adapter.seedForeignDomain(name, authCode, {
        registeredAt: new Date(now.getTime() - 200 * DAY_MS).toISOString(),
      });
      await adapter.persist();
      const result = await adapter.transferRequest(name, authCode);
      await recordInboundTransferRequest(user.id, adapter, result, now);
      return;
    }
    case "transfer-out": {
      adapter.seedOwnedDomain(name, {
        registeredAt: new Date(now.getTime() - 200 * DAY_MS).toISOString(),
        nameservers: DEMO_NAMESERVERS,
      });
      await adapter.persist();
      const record = await upsertDomainFromInfo(
        user.id,
        await adapter.info(name),
        now,
      );
      // 相手レジストラからの申請を受信したことにする（AC-12-4 の起点）
      const result = adapter.simulateInboundTransferRequest(name);
      await adapter.persist();
      await recordOutboundTransferRequest(
        user.id,
        adapter,
        result,
        { domainId: record.id },
        now,
      );
      // 受信後の pendingTransfer を保有行にも反映する
      await upsertDomainFromInfo(user.id, await adapter.info(name), now);
      return;
    }
  }
}

/**
 * FR-16 / AC-16-2: ユーザーのデータを消して、デモ用の 5 状態を投入し直す。
 * 返すのは投入したドメイン名（完了バナーで件数と名前を出す）。
 */
export async function resetDemoData(
  user: AuthUser,
  options: { db?: Db; now?: Date } = {},
): Promise<DemoResetResponse> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const suffix = demoSuffix();
  // TLD はシナリオ間で共通なので、アダプタの解決も 1 回で済む
  const names = DEMO_SCENARIOS.map((scenario) =>
    demoDomainName(suffix, scenario),
  );
  const first = names[0];
  if (first === undefined) {
    throw new ApiException("INTERNAL", "デモシナリオが定義されていません。");
  }
  const adapter = requireMockAdapter(first);

  // 先に前回ぶんをレジストリから掃除する（DB を消した後だと名前が引けない）
  await clearMockDomains(adapter, await listDemoDomainNames(db, user.id));
  await clearDemoData(db, user.id);

  for (const [index, scenario] of DEMO_SCENARIOS.entries()) {
    const name = names[index];
    if (name === undefined) {
      continue;
    }
    await seedScenario(db, user, adapter, scenario, name, now);
  }

  return { ok: true, domains: names };
}
