import { randomBytes } from "node:crypto";
import { type RegistryAdapter, RegistryError } from "@dopamin/registry";
import {
  type ApiErrorCode,
  type DomainAvailability,
  type DomainInfo,
  domainCheckRequestSchema,
  domainCreateRequestSchema,
  domainNameSchema,
  domainRenewRequestSchema,
  domainUpdateRequestSchema,
  isOperationAllowed,
  isRestorable,
  type RegistryId,
  type UpdateInput,
} from "@dopamin/shared";
import { Hono } from "hono";
import { ApiError } from "../lib/api-error";
import { reconcileOnTimeout } from "../lib/reconcile";
import { adapterForDomain, getRegistrySet } from "../lib/registries";
import { jsonValidator } from "../lib/validator";
import type { AppEnv } from "../types";

/** check 結果の 1 件分（§10.4）。uniqueness は FR-05 実装時に埋める（現状は常に null）。 */
interface DomainCheckItem {
  name: string;
  registry: RegistryId | null;
  availability: DomainAvailability;
  reason?: string;
  uniqueness: null;
  error?: { code: ApiErrorCode; message: string };
}

/** 登録時の authInfo を自動生成する（RFC 9154: 128bit 以上のエントロピー推奨）。 */
function generateAuthInfo(): string {
  return randomBytes(24).toString("base64url");
}

function parseDomainNameParam(raw: string): string {
  const parsed = domainNameSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "ドメイン名の形式が不正です。");
  }
  return parsed.data;
}

/** AC-08-2: 合計の有効期間が上限（10 年）を超える更新要求は送信前に弾く。 */
function assertRenewWithinLimit(
  currentExpiresAt: string,
  periodYears: number,
): void {
  const newExpiry = new Date(currentExpiresAt);
  newExpiry.setUTCFullYear(newExpiry.getUTCFullYear() + periodYears);
  const limit = new Date();
  limit.setUTCFullYear(limit.getUTCFullYear() + 10);
  if (newExpiry.getTime() > limit.getTime()) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "合計の有効期間が上限（10 年）を超えます。",
    );
  }
}

/**
 * AC-18-2 の照合条件: 要求した NS 全量が info に反映されているか。
 * clientStatuses はレジストリが成功応答のまま反映しない既知制約があるため照合対象にせず、
 * status 変更だけの要求は結果を確認できないものとして扱う。
 */
function isUpdateReflected(
  after: DomainInfo,
  body: {
    nameservers?: string[];
    clientStatuses?: { add?: string[]; remove?: string[] };
  },
): boolean {
  if (body.nameservers === undefined) {
    return false;
  }
  const desired = new Set(body.nameservers);
  const actual = new Set(after.nameservers.map((ns) => ns.toLowerCase()));
  if (desired.size !== actual.size) {
    return false;
  }
  for (const ns of desired) {
    if (!actual.has(ns)) {
      return false;
    }
  }
  return true;
}

export const domains = new Hono<AppEnv>()
  /** FR-03: ドメイン検索・空き確認。部分失敗を許容する（AC-03-2）。 */
  .post("/check", jsonValidator(domainCheckRequestSchema), async (c) => {
    const body = c.req.valid("json");
    const names =
      "names" in body
        ? body.names
        : body.tlds.map((tld) => `${body.sld}.${tld}`);
    const uniqueNames = [...new Set(names)];

    const registrySet = getRegistrySet();
    const groups = new Map<
      string,
      { adapter: RegistryAdapter; names: string[] }
    >();
    const resultByName = new Map<string, DomainCheckItem>();

    for (const name of uniqueNames) {
      const adapter = registrySet.forDomain(name);
      if (!adapter) {
        resultByName.set(name, {
          name,
          registry: null,
          availability: "error",
          uniqueness: null,
          error: { code: "VALIDATION_ERROR", message: "未対応の TLD です。" },
        });
        continue;
      }
      const group = groups.get(adapter.id) ?? { adapter, names: [] };
      group.names.push(name);
      groups.set(adapter.id, group);
    }

    await Promise.all(
      [...groups.values()].map(async ({ adapter, names: groupNames }) => {
        try {
          const results = await adapter.check(groupNames);
          const byName = new Map(results.map((r) => [r.name, r]));
          for (const name of groupNames) {
            const result = byName.get(name);
            if (result) {
              resultByName.set(name, {
                name,
                registry: adapter.id,
                availability: result.available ? "available" : "unavailable",
                ...(result.reason ? { reason: result.reason } : {}),
                uniqueness: null,
              });
            } else {
              resultByName.set(name, {
                name,
                registry: adapter.id,
                availability: "error",
                uniqueness: null,
                error: {
                  code: "REGISTRY_SPEC_MISMATCH",
                  message: "check の結果に対象ドメインが含まれていません。",
                },
              });
            }
          }
        } catch (err) {
          // 一方のレジストリが落ちていても他方の結果は返す（部分失敗の許容）
          const item: DomainCheckItem["error"] =
            err instanceof RegistryError
              ? {
                  code: err.code,
                  message: "レジストリへの確認に失敗しました。",
                }
              : { code: "INTERNAL", message: "空き確認に失敗しました。" };
          for (const name of groupNames) {
            resultByName.set(name, {
              name,
              registry: adapter.id,
              availability: "error",
              uniqueness: null,
              error: item,
            });
          }
        }
      }),
    );

    const results = uniqueNames.flatMap((name) => {
      const item = resultByName.get(name);
      return item ? [item] : [];
    });
    return c.json({ results });
  })

  /** FR-06: ドメイン登録。直前に check を再実行してから create する。 */
  .post("/", jsonValidator(domainCreateRequestSchema), async (c) => {
    const body = c.req.valid("json");
    const adapter = adapterForDomain(body.name);

    const [check] = await adapter.check([body.name]);
    if (!check?.available) {
      throw new ApiError(
        409,
        "CONFLICT",
        "このドメインは取得できません（既に登録されているか、登録が制限されています）。",
        check?.reason ? { reason: check.reason } : undefined,
      );
    }

    // AC-06-2: create タイムアウト時は再送せず info で存在確認して結果を確定する
    const domain = await reconcileOnTimeout(
      () =>
        adapter.create({
          name: body.name,
          periodYears: body.period,
          ...(body.nameservers && body.nameservers.length > 0
            ? { nameservers: body.nameservers }
            : {}),
          authInfo: generateAuthInfo(),
        }),
      () => adapter.info(body.name),
    );
    return c.json({ domain }, 201);
  })

  /** FR-07: ドメイン詳細（レジストリの info で最新化して返す）。 */
  .get("/:name", async (c) => {
    const name = parseDomainNameParam(c.req.param("name"));
    const domain = await adapterForDomain(name).info(name);
    return c.json({ domain });
  })

  /** FR-08: 更新（有効期限延長）。curExpDate はレジストリ仕様により必須のため info から取得する。 */
  .post("/:name/renew", jsonValidator(domainRenewRequestSchema), async (c) => {
    const name = parseDomainNameParam(c.req.param("name"));
    const { period } = c.req.valid("json");
    const adapter = adapterForDomain(name);

    const current = await adapter.info(name);
    const opCheck = isOperationAllowed("renew", current.statuses);
    if (!opCheck.allowed) {
      throw new ApiError(
        409,
        "OPERATION_NOT_ALLOWED",
        "現在のステータスでは更新できません。",
        {
          statuses: opCheck.blockedBy,
        },
      );
    }
    if (!current.expiresAt) {
      throw new ApiError(
        409,
        "OPERATION_NOT_ALLOWED",
        "有効期限を取得できませんでした。",
      );
    }
    assertRenewWithinLimit(current.expiresAt, period);

    // AC-18-2: タイムアウト時は info で有効期限の延長が反映されたかを照合する
    const previousExpiresAt = current.expiresAt;
    const domain = await reconcileOnTimeout(
      () =>
        adapter.renew(name, {
          periodYears: period,
          currentExpiresAt: previousExpiresAt,
        }),
      async () => {
        const after = await adapter.info(name);
        return after.expiresAt !== null &&
          new Date(after.expiresAt).getTime() >
            new Date(previousExpiresAt).getTime()
          ? after
          : null;
      },
    );
    return c.json({ domain });
  })

  /** FR-09: 情報修正（NS・クライアントステータス）。NS は全量指定を差分（add/rem）に変換する。 */
  .patch("/:name", jsonValidator(domainUpdateRequestSchema), async (c) => {
    const name = parseDomainNameParam(c.req.param("name"));
    const body = c.req.valid("json");
    const adapter = adapterForDomain(name);

    const current = await adapter.info(name);
    // ロック解除だけの要求は clientUpdateProhibited 中でも許可する（解除経路を残す）
    const unlockOnly =
      body.nameservers === undefined &&
      (body.clientStatuses?.add?.length ?? 0) === 0 &&
      (body.clientStatuses?.remove?.length ?? 0) > 0;
    const opCheck = isOperationAllowed("update", current.statuses, {
      unlockOnly,
    });
    if (!opCheck.allowed) {
      throw new ApiError(
        409,
        "OPERATION_NOT_ALLOWED",
        "現在のステータスでは変更できません。",
        {
          statuses: opCheck.blockedBy,
        },
      );
    }

    const input: UpdateInput = {};
    if (body.nameservers !== undefined) {
      // 入力はスキーマで小文字化済み。レジストリ側の表記ゆれと誤差分を出さないよう現状も小文字化して比較する
      const desired = new Set(body.nameservers);
      const currentNs = new Set(
        current.nameservers.map((ns) => ns.toLowerCase()),
      );
      const add = [...desired].filter((ns) => !currentNs.has(ns));
      const remove = [...currentNs].filter((ns) => !desired.has(ns));
      if (add.length > 0) {
        input.addNameservers = add;
      }
      if (remove.length > 0) {
        input.removeNameservers = remove;
      }
    }
    if (body.clientStatuses?.add && body.clientStatuses.add.length > 0) {
      input.addStatuses = body.clientStatuses.add;
    }
    if (body.clientStatuses?.remove && body.clientStatuses.remove.length > 0) {
      input.removeStatuses = body.clientStatuses.remove;
    }

    const hasChanges =
      (input.addNameservers?.length ?? 0) > 0 ||
      (input.removeNameservers?.length ?? 0) > 0 ||
      (input.addStatuses?.length ?? 0) > 0 ||
      (input.removeStatuses?.length ?? 0) > 0;
    if (!hasChanges) {
      return c.json({ domain: current });
    }

    // AC-18-2: タイムアウト時は info で要求した変更がすべて反映されたかを照合する
    const domain = await reconcileOnTimeout(
      () => adapter.update(name, input),
      async () => {
        const after = await adapter.info(name);
        return isUpdateReflected(after, body) ? after : null;
      },
    );
    return c.json({ domain });
  })

  /** FR-10: 廃止。削除ロック中は実行しない（AC-10-2）。 */
  .delete("/:name", async (c) => {
    const name = parseDomainNameParam(c.req.param("name"));
    const adapter = adapterForDomain(name);

    const current = await adapter.info(name);
    const opCheck = isOperationAllowed("delete", current.statuses);
    if (!opCheck.allowed) {
      throw new ApiError(
        409,
        "OPERATION_NOT_ALLOWED",
        "現在のステータスでは廃止できません。",
        {
          statuses: opCheck.blockedBy,
        },
      );
    }

    // AC-18-2: タイムアウト時は info で削除（pendingDelete / RGP / 消滅）を照合する
    await reconcileOnTimeout(
      () => adapter.delete(name),
      async () => {
        try {
          const after = await adapter.info(name);
          return after.statuses.includes("pendingDelete") ||
            after.rgpStatuses.includes("redemptionPeriod")
            ? { name: after.name }
            : null;
        } catch (err) {
          if (err instanceof RegistryError && err.code === "NOT_FOUND") {
            return { name }; // 即時削除済み
          }
          throw err;
        }
      },
    );
    // 削除後の状態（RGP 等）を返す。即時削除で info が 404 になる場合は null。
    let domain: DomainInfo | null = null;
    try {
      domain = await adapter.info(name);
    } catch {
      domain = null;
    }
    return c.json({ domain });
  })

  /** FR-11: 復旧（RGP restore）。redemptionPeriod 中のみ実行できる（AC-11-2）。 */
  .post("/:name/restore", async (c) => {
    const name = parseDomainNameParam(c.req.param("name"));
    const adapter = adapterForDomain(name);

    const current = await adapter.info(name);
    if (!isRestorable(current.rgpStatuses, current.statuses)) {
      throw new ApiError(
        409,
        "OPERATION_NOT_ALLOWED",
        "復旧猶予期間（RGP）ではないため復旧できません。",
        { statuses: current.statuses, rgpStatuses: current.rgpStatuses },
      );
    }

    // AC-18-2: タイムアウト時は info で RGP からの離脱を照合する
    const domain = await reconcileOnTimeout(
      () => adapter.restore(name),
      async () => {
        const after = await adapter.info(name);
        return !after.rgpStatuses.includes("redemptionPeriod") &&
          !after.statuses.includes("pendingDelete")
          ? after
          : null;
      },
    );
    return c.json({ domain });
  })

  /** FR-12: 移管 OUT 用 AuthCode。info には含まれないため rotate-auth-info で再生成する。 */
  .get("/:name/auth-code", async (c) => {
    const name = parseDomainNameParam(c.req.param("name"));
    const authCode = await adapterForDomain(name).authCode(name);
    // 取得のたびに authInfo が再生成される（前回表示した値は無効になる）
    return c.json({ authCode, rotated: true });
  });
