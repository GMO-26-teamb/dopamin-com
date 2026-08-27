import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Db } from "@dopamin/db";
import {
  createKitaqAdapter,
  createRegistrySet,
  type KitaqAdapterConfig,
  RegistryError,
} from "@dopamin/registry";
import {
  apiErrorSchema,
  pollConsumeResultSchema,
  transfersListResponseSchema,
} from "@dopamin/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../../src/index";
import { setDbForTesting } from "../../src/lib/db";
import { setRegistrySetForTesting } from "../../src/lib/registries";
import { setRetrySleepForTesting } from "../../src/lib/retry";
import { setContactStoreForTesting } from "../../src/services/contact.service";
import { setDomainStoreForTesting } from "../../src/services/domain-store";
import { setTransferStoreForTesting } from "../../src/services/transfer-store";
import { createTestDb } from "../helpers/db";
import { createTestSession } from "../helpers/session";

/**
 * 実 Kitaqnic を Hono API 経由で一巡する手動 E2E。
 *
 * アプリ側 A（`.env.local`）は必ず `app.request()` から操作し、相手レジストラ B
 * （`.env.test`）だけを実アダプタで動かす。通常の `pnpm test` / CI では skip し、
 * `KITAQNIC_API_TRANSFER_TEST=1` の明示時だけ実データを書き換える。
 */

const requested = process.env.KITAQNIC_API_TRANSFER_TEST === "1";
const DOMAIN = `dopamin-api-trf-${Date.now().toString(36)}.xyz`;

function loadEnv(file: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const matched = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (matched?.[1] !== undefined && matched[2] !== undefined) {
      result[matched[1]] = matched[2].trim().replace(/^"|"$/g, "");
    }
  }
  return result;
}

function configFrom(file: string): KitaqAdapterConfig {
  const values = loadEnv(file);
  const required = [
    "KITAQNIC_BASE_URL",
    "KITAQNIC_GATE_USER",
    "KITAQNIC_GATE_PASSWORD",
    "KITAQNIC_REGISTRAR_ID",
    "KITAQNIC_API_KEY",
  ] as const;
  for (const key of required) {
    if (!values[key]) {
      throw new Error(`${file}: ${key} が設定されていません。`);
    }
  }
  return {
    id: "kitaqnic",
    baseUrl: values.KITAQNIC_BASE_URL as string,
    gateUser: values.KITAQNIC_GATE_USER as string,
    gatePassword: values.KITAQNIC_GATE_PASSWORD as string,
    registrarId: values.KITAQNIC_REGISTRAR_ID as string,
    apiKey: values.KITAQNIC_API_KEY as string,
  };
}

describe.skipIf(!requested)(
  "kitaqnic 実レジストリ: Hono API 移管 E2E（.env.local ↔ .env.test）",
  () => {
    let db: Db;
    let closeDb: (() => Promise<void>) | undefined;
    let cookie: string;
    let appRegistrar: ReturnType<typeof createKitaqAdapter>;
    let counterpart: ReturnType<typeof createKitaqAdapter>;
    let creationAttempted = false;
    let cleanedUp = false;

    beforeAll(async () => {
      const envLocal = fileURLToPath(
        new URL("../../.env.local", import.meta.url),
      );
      const envTest = fileURLToPath(
        new URL("../../.env.test", import.meta.url),
      );
      const appConfig = configFrom(envLocal);
      const counterpartConfig = configFrom(envTest);
      if (appConfig.registrarId === counterpartConfig.registrarId) {
        throw new Error(
          ".env.local と .env.test の KITAQNIC_REGISTRAR_ID は別レジストラである必要があります。",
        );
      }

      appRegistrar = createKitaqAdapter(appConfig);
      counterpart = createKitaqAdapter(counterpartConfig);
      ({ db, close: closeDb } = await createTestDb());
      setDbForTesting(db);
      setDomainStoreForTesting(null);
      setTransferStoreForTesting(null);
      setContactStoreForTesting(null);
      setRegistrySetForTesting(
        createRegistrySet({ mode: "real", adapters: [appRegistrar] }),
      );
      setRetrySleepForTesting(() => Promise.resolve());
      cookie = (await createTestSession(db)).cookie;
    }, 30_000);

    afterAll(async () => {
      // 中断時も pending を可能な限り取り消し、現在のスポンサー側から削除する。
      // 失敗を黙らせずドメイン名だけを残す（認証情報・AuthCode・生応答は出さない）。
      if (creationAttempted && !cleanedUp) {
        for (const adapter of [appRegistrar, counterpart]) {
          try {
            await adapter.transferCancel(DOMAIN);
          } catch {
            // pending でない／申請側でない場合は次を試す
          }
        }
        for (const adapter of [appRegistrar, counterpart]) {
          try {
            await adapter.delete(DOMAIN);
            cleanedUp = true;
            break;
          } catch (error) {
            if (error instanceof RegistryError && error.code === "NOT_FOUND") {
              cleanedUp = true;
              break;
            }
          }
        }
        if (!cleanedUp) {
          console.warn(
            JSON.stringify({
              level: "warn",
              type: "live_transfer_cleanup_failed",
              domain: DOMAIN,
              message:
                "実レジストリのテストドメインを削除できませんでした。手動確認が必要です。",
            }),
          );
        }
      }

      setRetrySleepForTesting(null);
      setRegistrySetForTesting(null);
      setContactStoreForTesting(null);
      setDomainStoreForTesting(null);
      setTransferStoreForTesting(null);
      setDbForTesting(null);
      await closeDb?.();
    }, 60_000);

    async function api(path: string, init?: RequestInit): Promise<Response> {
      return app.request(`/api/v1${path}`, {
        ...init,
        headers: { cookie, ...init?.headers },
      });
    }

    function sendJson(path: string, body: unknown): Promise<Response> {
      return api(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    async function authCode(): Promise<string> {
      const response = await api(`/domains/${DOMAIN}/auth-code`, {
        method: "POST",
      });
      expect(response.status).toBe(200);
      return ((await response.json()) as { authCode: string }).authCode;
    }

    async function consumePoll() {
      const response = await api("/registry/poll", { method: "POST" });
      expect(response.status).toBe(200);
      const result = pollConsumeResultSchema.parse(await response.json());
      expect(result.failures).toEqual([]);
      return result;
    }

    it("登録 → OUT拒否 → OUT承認 → IN取消 → IN承認 → 取り込み → 廃止を API で一巡する", {
      timeout: 300_000,
    }, async () => {
      creationAttempted = true;
      const created = await sendJson("/domains", { name: DOMAIN, period: 1 });
      expect(created.status).toBe(201);

      // OUT 1 回目: 相手が申請し、API で受信・拒否する。
      await counterpart.transferRequest(DOMAIN, await authCode());
      expect(await consumePoll()).toMatchObject({ created: 1 });
      let transfers = transfersListResponseSchema.parse(
        await (await api("/transfers")).json(),
      );
      const rejectedOut = transfers.outbound.find(
        (row) => row.domainName === DOMAIN,
      );
      expect(rejectedOut).toBeDefined();
      const rejected = await api(`/transfers/${rejectedOut?.id}/reject`, {
        method: "POST",
      });
      expect(rejected.status).toBe(200);
      expect((await counterpart.info(DOMAIN)).statuses).not.toContain(
        "pendingTransfer",
      );

      // OUT 2 回目: API で承認し、保有一覧から外れる。
      await counterpart.transferRequest(DOMAIN, await authCode());
      expect(await consumePoll()).toMatchObject({ created: 1 });
      transfers = transfersListResponseSchema.parse(
        await (await api("/transfers")).json(),
      );
      const approvedOut = transfers.outbound.find(
        (row) => row.domainName === DOMAIN,
      );
      expect(approvedOut).toBeDefined();
      const approved = await api(`/transfers/${approvedOut?.id}/approve`, {
        method: "POST",
      });
      expect(approved.status).toBe(200);
      expect(
        (
          (await (await api("/domains")).json()) as {
            domains: { name: string }[];
          }
        ).domains.some((domain) => domain.name === DOMAIN),
      ).toBe(false);

      // IN: 実レジストリの誤 AuthCode を API の統一エラーへ変換する。
      const wrong = await sendJson("/transfers", {
        name: DOMAIN,
        authCode: "definitely-wrong-auth-code",
      });
      expect(wrong.status).toBe(422);
      expect(apiErrorSchema.parse(await wrong.json()).error.code).toBe(
        "REGISTRY_REJECTED",
      );

      // 一度 API から申請して取消し、pending 行と実レジストリの双方が戻ることを確認する。
      const firstInbound = await sendJson("/transfers", {
        name: DOMAIN,
        authCode: await counterpart.authCode(DOMAIN),
      });
      expect(firstInbound.status).toBe(202);
      const firstInboundId = (
        (await firstInbound.json()) as {
          record: { id: string };
        }
      ).record.id;
      expect(
        (await api(`/transfers/${firstInboundId}/cancel`, { method: "POST" }))
          .status,
      ).toBe(200);
      expect((await counterpart.info(DOMAIN)).statuses).not.toContain(
        "pendingTransfer",
      );

      // 再申請を相手が承認。API の Poll 消化で domains に取り込み直す。
      const secondInbound = await sendJson("/transfers", {
        name: DOMAIN,
        authCode: await counterpart.authCode(DOMAIN),
      });
      expect(secondInbound.status).toBe(202);
      await counterpart.transferApprove(DOMAIN);
      expect(await consumePoll()).toMatchObject({ settled: 1 });

      const domains = (await (await api("/domains")).json()) as {
        domains: { name: string }[];
      };
      expect(domains.domains.some((domain) => domain.name === DOMAIN)).toBe(
        true,
      );

      const removed = await api(`/domains/${DOMAIN}`, { method: "DELETE" });
      expect(removed.status).toBe(200);
      cleanedUp = true;
    });
  },
);
