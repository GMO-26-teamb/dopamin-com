import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../client";
import * as schema from "../schema";

/**
 * デモデータ（docs/requirements.md FR-16 / §11.1）の定義とリセット。
 *
 * ここが持つのは「どんなデモ用ドメインを、どんな名前で用意するか」と
 * 「ユーザーのデータをどこまで消すか」の 2 つだけ。
 *
 * レジストリ側の状態づくり（mock アダプタの `seedOwnedDomain` / `simulate*`）と、
 * その結果を `domains` / `transfers` に書く処理は `apps/api` の demo.service が持つ。
 * レジストリ固有の処理を `packages/registry` の外に出さない（CLAUDE.md / NFR-07）ためと、
 * 行の写像（`toDomainValues` など）を二重に持たないため。
 */

/** デモ用ドメインの命名（FR-16「`dopamin-demo-<短いランダム>`」）。 */
export const DEMO_DOMAIN_PREFIX = "dopamin-demo-";

/** ランダム部分の文字数。SLD 全体が 63 文字を超えない範囲で短くする。 */
export const DEMO_SUFFIX_LENGTH = 6;

/**
 * デモで再現する状態（§3.3 のデモシナリオ 6〜8 / FR-16）。
 * 実レジストリでは維持できない状態を含むため、投入先は mock 固定
 * （実登録は【要確認 §21.2 #7】が解けるまで行わない）。
 */
export const DEMO_SCENARIOS = [
  /** Active（`ok`）。詳細・サブドメイン設計の出発点。 */
  "active",
  /** RGP（`redemptionPeriod`）。復旧ボタン（FR-11）の確認用。 */
  "rgp",
  /** 有効期限が 20 日後。期限警告と更新（FR-08）の確認用。 */
  "expiring",
  /** 移管 IN 申請中（自分が gaining）。 */
  "transfer-in",
  /** 受信した移管 OUT 申請（自分が losing）。承認 / 拒否の確認用。 */
  "transfer-out",
] as const;
export type DemoScenario = (typeof DEMO_SCENARIOS)[number];

/** 期限間近シナリオの残日数（§11.4 の期限警告に掛かる範囲）。 */
export const DEMO_EXPIRING_IN_DAYS = 20;

/** RGP シナリオの残日数（§11.4 Redemption GP の目安 30 日）。 */
export const DEMO_REDEMPTION_DAYS = 30;

/** デモ用ドメインの TLD。mock は全対応 TLD を引き受けるので 1 つに揃える。 */
export const DEMO_TLD = "com";

/** 衝突しにくい短いランダム文字列（英数小文字）。 */
export function demoSuffix(length: number = DEMO_SUFFIX_LENGTH): string {
  return randomBytes(16)
    .toString("base64url")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, length);
}

/** `dopamin-demo-<rand>-<scenario>.<tld>`。どのシナリオの行かが名前で分かるようにする。 */
export function demoDomainName(
  suffix: string,
  scenario: DemoScenario,
  tld: string = DEMO_TLD,
): string {
  return `${DEMO_DOMAIN_PREFIX}${suffix}-${scenario}.${tld}`;
}

/** そのドメイン名がデモ用の投入で作られたものか。 */
export function isDemoDomainName(name: string): boolean {
  return name.toLowerCase().startsWith(DEMO_DOMAIN_PREFIX);
}

/**
 * リセット時に消す対象（FR-16「ユーザーのドメイン・設計・ログを削除」）。
 *
 * `subdomain_plans` と `dns_records` は `domains` への FK が ON DELETE CASCADE なので、
 * `domains` を消せば一緒に消える。`transfers` の `domain_id` は ON DELETE SET NULL で
 * 行が残るため、`user_id` で明示的に消す。
 * `operation_logs` の `user_id` は ON DELETE SET NULL（退会後も恒久保存）だが、
 * デモリセットは「この画面をきれいにする」操作なので、本人の行は消す。
 */
export async function clearDemoData(db: Db, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // domains を先に消すと subdomain_plans / dns_records も CASCADE で落ちる
    await tx.delete(schema.domains).where(eq(schema.domains.userId, userId));
    await tx
      .delete(schema.transfers)
      .where(eq(schema.transfers.userId, userId));
    await tx
      .delete(schema.operationLogs)
      .where(eq(schema.operationLogs.userId, userId));
    await tx.delete(schema.aiLogs).where(eq(schema.aiLogs.userId, userId));
  });
}

/**
 * デモ用ドメインに紐づく mock レジストリの状態を掃除するための名前一覧。
 * リセットは同じユーザーが何度も押すので、前回の名前をレジストリから消せるよう
 * 消す前に控えておく。
 */
export async function listDemoDomainNames(
  db: Db,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ name: schema.domains.name })
    .from(schema.domains)
    .where(eq(schema.domains.userId, userId));
  const fromTransfers = await db
    .select({ name: schema.transfers.domainName })
    .from(schema.transfers)
    .where(eq(schema.transfers.userId, userId));
  const names = new Set(
    [...rows, ...fromTransfers]
      .map((row) => row.name)
      .filter((name) => isDemoDomainName(name)),
  );
  return [...names];
}

/** テスト・保守用: 指定した名前の `domains` 行だけを消す。 */
export async function deleteDomainsByName(
  db: Db,
  names: readonly string[],
): Promise<void> {
  if (names.length === 0) {
    return;
  }
  await db
    .delete(schema.domains)
    .where(inArray(schema.domains.name, [...names]));
}
