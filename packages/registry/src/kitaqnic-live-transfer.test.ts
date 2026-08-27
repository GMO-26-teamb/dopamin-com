/**
 * kitaqnic 実レジストリに対する移管フローの手動 E2E（issue #175 の実機検証）。
 *
 * - 一時ファイル。CI では動かさない前提（実行後に削除する）。
 * - kitaqsign はメンテナンス中のため kitaqnic のみを使う。
 * - アカウント: A = teamb（apps/api/.env.local。アプリが使う本体）
 *              B = teamb-2（apps/api/.env.test。相手レジストラ役）
 * - 検証すること:
 *   1. OUT: A 保有ドメインへ B が transferRequest → A に Poll 通知 → 拒否 / 承認
 *   2. 運営アナウンスの修正: clientTransferProhibited が info に反映され、移管申請を実際にブロックする
 *   3. IN: B 保有になったドメインを A が transferRequest で取り戻す
 * - 秘密情報（API キー・gate パスワード・AuthCode）はログに出さない。
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PollMessage } from "@dopamin/shared";
import { describe, expect, it } from "vitest";
import type { RegistryAdapter } from "./adapter";
import { RegistryError } from "./errors";
import { createKitaqAdapter } from "./kitaq";

function loadEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m?.[1] !== undefined && m[2] !== undefined) {
      out[m[1]] = m[2].trim().replace(/^"|"$/g, "");
    }
  }
  return out;
}

function adapterFrom(env: Record<string, string>): RegistryAdapter {
  const required = [
    "KITAQNIC_BASE_URL",
    "KITAQNIC_GATE_USER",
    "KITAQNIC_GATE_PASSWORD",
    "KITAQNIC_REGISTRAR_ID",
    "KITAQNIC_API_KEY",
  ];
  for (const key of required) {
    if (!env[key]) {
      throw new Error(`環境変数 ${key} がありません`);
    }
  }
  return createKitaqAdapter({
    id: "kitaqnic",
    baseUrl: env.KITAQNIC_BASE_URL as string,
    gateUser: env.KITAQNIC_GATE_USER as string,
    gatePassword: env.KITAQNIC_GATE_PASSWORD as string,
    registrarId: env.KITAQNIC_REGISTRAR_ID as string,
    apiKey: env.KITAQNIC_API_KEY as string,
  });
}

/**
 * env の読み込みとアダプタ生成はテスト実行時まで遅延させる。
 * モジュール読み込み時に行うと、`.env.local` / `.env.test` を持たない環境
 * （CI・他メンバーのローカル）で skip ガードに届く前に import が落ちるため。
 */
function setupAdapters(): { A: RegistryAdapter; B: RegistryAdapter } {
  const repoRoot = path.resolve(process.cwd(), "../..");
  const envA = loadEnv(path.join(repoRoot, "apps/api/.env.local"));
  const envB = loadEnv(path.join(repoRoot, "apps/api/.env.test"));
  return {
    A: adapterFrom(envA), // teamb（アプリ本体）
    B: adapterFrom(envB), // teamb-2（相手レジストラ役）
  };
}

const DOMAIN = `dopamin-trf-${Date.now().toString(36)}.xyz`;

function mask(secret: string): string {
  return `${secret.slice(0, 2)}***(${secret.length}字)`;
}

/**
 * Poll キューを読み進めて ack する。FIFO の先頭に無関係なメッセージがあると
 * 目的の通知に届かないため、読んだものはすべてログに残してから ack する。
 */
async function drainPoll(
  adapter: RegistryAdapter,
  label: string,
  max = 20,
): Promise<PollMessage[]> {
  const seen: PollMessage[] = [];
  for (let i = 0; i < max; i++) {
    const msg = await adapter.poll();
    if (msg === null) {
      break;
    }
    seen.push(msg);
    const related = msg.domainName === DOMAIN ? "" : " [テスト対象外ドメイン]";
    console.log(
      `[poll:${label}] type=${msg.type} domain=${msg.domainName ?? "?"} id=${msg.id} remaining=${msg.count}${related}`,
    );
    if (msg.domainName !== DOMAIN) {
      console.log(
        `[poll:${label}] 対象外メッセージの raw:`,
        JSON.stringify(msg.raw),
      );
    }
    await adapter.ackMessage(msg.id);
  }
  return seen;
}

// 実レジストリへ書き込む手動テスト。KITAQNIC_LIVE_E2E=1 のときだけ動かし、
// 通常の `pnpm test` / `pnpm check` では skip する（誤爆でドメインを作らないため）
describe.skipIf(process.env.KITAQNIC_LIVE_E2E !== "1")(
  "kitaqnic 実レジストリ: 移管フロー E2E（teamb ↔ teamb-2）",
  () => {
    it("OUT（拒否→承認）→ clientTransferProhibited のブロック → IN で取り戻すまで一巡する", {
      timeout: 300_000,
    }, async () => {
      const { A, B } = setupAdapters();

      // ---- 0. 疎通（gate + API キー） ----
      const helloA = await A.hello();
      const helloB = await B.hello();
      console.log(
        `[hello] A=${A.registrarId} B=${B.registrarId} tlds=${helloA.tlds.length}種`,
      );
      expect(helloA.registry).toBe("kitaqnic");
      expect(helloB.registry).toBe("kitaqnic");
      expect(helloA.tlds).toContain("xyz");

      // ---- 1. A が捨てドメインを登録 ----
      const initialAuth = `Trf-${randomBytes(9).toString("base64url")}`;
      const created = await A.create({
        name: DOMAIN,
        periodYears: 1,
        authInfo: initialAuth,
      });
      console.log(`[create] ${DOMAIN} statuses=${created.statuses.join(",")}`);
      expect(created.name).toBe(DOMAIN);

      // ---- 2. OUT: AuthCode 発行 → B が移管申請 ----
      const code1 = await A.authCode(DOMAIN);
      console.log(`[authCode] rotate-auth-info 取得 ${mask(code1)}`);
      expect(code1.length).toBeGreaterThan(0);

      const requested1 = await B.transferRequest(DOMAIN, code1);
      console.log(
        `[transferRequest:B] status=${requested1.status} registryStatus=${requested1.registryStatus ?? "-"} actByAt=${requested1.actByAt ?? "-"}`,
      );
      expect(requested1.status).toBe("pending");

      const pendingInfo = await A.info(DOMAIN);
      console.log(`[info:A] statuses=${pendingInfo.statuses.join(",")}`);
      expect(pendingInfo.statuses).toContain("pendingTransfer");

      // ---- 3. A に Poll 通知（transfer_request）が届く ----
      const pollA1 = await drainPoll(A, "A(申請受信)");
      const requestNotice = pollA1.find(
        (m) => m.type === "transfer_request" && m.domainName === DOMAIN,
      );
      expect(requestNotice).toBeDefined();

      // ---- 4. 拒否（AC-12-4 の reject パス。保有は維持される） ----
      const rejected = await A.transferReject(DOMAIN);
      console.log(`[transferReject:A] status=${rejected.status}`);
      expect(rejected.status).toBe("rejected");
      const afterReject = await A.info(DOMAIN);
      expect(afterReject.statuses).not.toContain("pendingTransfer");
      const pollB1 = await drainPoll(B, "B(拒否通知)");
      console.log(`[poll:B] 拒否後の通知件数=${pollB1.length}`);

      // ---- 5. 再申請 → 承認（AC-12-4 / AC-12-5 の approve パス） ----
      const code2 = await A.authCode(DOMAIN);
      const requested2 = await B.transferRequest(DOMAIN, code2);
      expect(requested2.status).toBe("pending");
      const approved = await A.transferApprove(DOMAIN);
      console.log(`[transferApprove:A] status=${approved.status}`);
      expect(approved.status).toBe("approved");

      // B がスポンサーになった（B からは info が引ける）
      const infoAsB = await B.info(DOMAIN);
      console.log(
        `[info:B] 移管後 statuses=${infoAsB.statuses.join(",")} lastTransferAt=${infoAsB.lastTransferAt ?? "-"}`,
      );
      // 非スポンサーからの info（要確認 #12 の実測）。結果は観察してログに残すだけ
      try {
        const infoAsA = await A.info(DOMAIN);
        console.log(
          `[観察] 非スポンサー A からの info: 成功 statuses=${infoAsA.statuses.join(",")} sponsoringRegistrarId=${infoAsA.sponsoringRegistrarId ?? "null"}`,
        );
      } catch (e) {
        const detail =
          e instanceof RegistryError
            ? `${e.code} registryCode=${e.registryCode ?? "-"}`
            : String(e);
        console.log(`[観察] 非スポンサー A からの info: エラー ${detail}`);
      }
      await drainPoll(B, "B(承認通知)");
      await drainPoll(A, "A(承認後)");

      // ---- 6. 運営アナウンスの修正検証: clientTransferProhibited が移管をブロックする ----
      const locked = await B.update(DOMAIN, {
        addStatuses: ["clientTransferProhibited"],
      });
      console.log(`[update:B] ロック後 statuses=${locked.statuses.join(",")}`);
      expect(locked.statuses).toContain("clientTransferProhibited");

      const codeLocked = await B.authCode(DOMAIN);
      let lockError: unknown = null;
      try {
        await A.transferRequest(DOMAIN, codeLocked);
      } catch (e) {
        lockError = e;
      }
      expect(lockError).toBeInstanceOf(RegistryError);
      const lockRegistryError = lockError as RegistryError;
      console.log(
        `[ロック検証] transferRequest は拒否された: code=${lockRegistryError.code} registryCode=${lockRegistryError.registryCode ?? "-"} message=${lockRegistryError.message}`,
      );

      // 解除すると再び申請できる
      const unlocked = await B.update(DOMAIN, {
        removeStatuses: ["clientTransferProhibited"],
      });
      expect(unlocked.statuses).not.toContain("clientTransferProhibited");

      // ---- 7. IN: A が取り戻す（アプリの移管 IN と同じ経路） ----
      const codeBack = await B.authCode(DOMAIN);
      const requestedBack = await A.transferRequest(DOMAIN, codeBack);
      console.log(`[transferRequest:A] status=${requestedBack.status}`);
      expect(requestedBack.status).toBe("pending");
      const approvedBack = await B.transferApprove(DOMAIN);
      expect(approvedBack.status).toBe("approved");
      const infoBackAsA = await A.info(DOMAIN);
      console.log(
        `[info:A] 取り戻し後 statuses=${infoBackAsA.statuses.join(",")} lastTransferAt=${infoBackAsA.lastTransferAt ?? "-"}`,
      );
      expect(infoBackAsA.statuses).not.toContain("pendingTransfer");

      // ---- 8. 後片付け: 両キューを掃除して A がドメインを削除 ----
      await drainPoll(A, "A(最終)");
      await drainPoll(B, "B(最終)");
      const deleted = await A.delete(DOMAIN);
      console.log(`[delete:A] ${deleted.name} を削除（RGP 入りの可能性あり）`);
      expect(deleted.name).toBe(DOMAIN);
    });
  },
);
