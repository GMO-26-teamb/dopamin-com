import { randomBytes } from "node:crypto";
import { type RegistryAdapter, RegistryError } from "@dopamin/registry";
import {
  type ApiErrorCode,
  type DomainAvailability,
  type DomainInfo,
  type DomainUniqueness,
  domainCheckRequestSchema,
  domainCreateRequestSchema,
  domainNameSchema,
  domainRenewRequestSchema,
  domainUpdateRequestSchema,
  getDefaultPreparedCorpus,
  isOperationAllowed,
  isRestorable,
  type RegistryId,
  scoreDistinctiveness,
  splitDomainName,
  toDomainUniqueness,
  type UpdateInput,
} from "@dopamin/shared";
import { Hono } from "hono";
import { ApiException } from "../lib/errors";
import { reconcileOnTimeout } from "../lib/reconcile";
import { adapterForDomain, getRegistrySet } from "../lib/registries";
import { jsonValidator } from "../lib/validator";
import { requireSession } from "../middleware/session";
import {
  listDomainSummaries,
  removeDomain,
  requireOwnedDomain,
  toDomainSummary,
  upsertDomainFromInfo,
} from "../services/domain.service";
import type { DomainRecord } from "../services/domain-store";
import { syncDomainsAndConsumePoll } from "../services/poll.service";
import type { AuthedEnv } from "../types";

/** check 結果の 1 件分（§10.4）。uniqueness は available のときのみ付く（§10.4 の例に準拠）。 */
interface DomainCheckItem {
  name: string;
  registry: RegistryId | null;
  availability: DomainAvailability;
  reason?: string;
  uniqueness: DomainUniqueness | null;
  error?: { code: ApiErrorCode; message: string };
}

/**
 * FR-05: SLD の独自性スコアを計算する（リクエスト内で SLD ごとにメモ化）。
 * スコア計算は check 本体の付随情報なので、失敗しても check 結果は返す。
 */
function createUniquenessResolver(): (name: string) => DomainUniqueness | null {
  const bySld = new Map<string, DomainUniqueness | null>();
  return (name) => {
    try {
      const { sld } = splitDomainName(name);
      let u = bySld.get(sld);
      if (u === undefined) {
        u = toDomainUniqueness(
          scoreDistinctiveness(sld, getDefaultPreparedCorpus()),
        );
        bySld.set(sld, u);
      }
      return u;
    } catch {
      return null;
    }
  };
}

/** 登録時の authInfo を自動生成する（RFC 9154: 128bit 以上のエントロピー推奨）。 */
function generateAuthInfo(): string {
  return randomBytes(24).toString("base64url");
}

function parseDomainNameParam(raw: string): string {
  const parsed = domainNameSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiException("VALIDATION_ERROR", "ドメイン名の形式が不正です。");
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
    throw new ApiException(
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

/**
 * キャッシュを返してよい失敗か（AC-07-2 / AC-18-1）。
 * レジストリに繋がらない・応答が読めない場合だけキャッシュに退避する。
 * NOT_FOUND や拒否応答は「レジストリ側の事実」なのでそのまま返す。
 */
function isTransportFailure(err: RegistryError): boolean {
  return (
    err.code === "REGISTRY_TIMEOUT" ||
    err.code === "REGISTRY_UNAVAILABLE" ||
    err.code === "REGISTRY_SPEC_MISMATCH"
  );
}

/**
 * 詳細レスポンス（FR-07）。`domain` は正規化済み `info`、`summary` は一覧と同じ要約。
 * `stale = true` はレジストリに繋がらず DB キャッシュを返したことを示す（AC-07-2）。
 */
function detailResponse(record: DomainRecord, stale: boolean) {
  return {
    domain: record.info,
    summary: toDomainSummary(record, stale),
    stale,
    syncedAt: record.syncedAt.toISOString(),
  };
}

export const domains = new Hono<AuthedEnv>()
  // NFR-04 / AC-01-3: ドメイン操作はすべて認証必須。所有権は requireOwnedDomain で個別に見る
  .use(requireSession)

  /** FR-02: 保有ドメイン一覧（DB キャッシュ。レジストリには問い合わせない）。 */
  .get("/", async (c) => {
    const list = await listDomainSummaries(c.get("user").id);
    return c.json({ domains: list });
  })

  /**
   * FR-02 / FR-12 / AC-02-4: 全保有ドメインを info で再同期し、Poll も消化する（§10.1）。
   * 1 件の失敗では全体を落とさない。
   */
  .post("/sync", async (c) => {
    return c.json(await syncDomainsAndConsumePoll(c.get("user").id));
  })

  /** FR-03: ドメイン検索・空き確認。部分失敗を許容する（AC-03-2）。 */
  .post("/check", jsonValidator(domainCheckRequestSchema), async (c) => {
    const body = c.req.valid("json");
    const names =
      "names" in body
        ? body.names
        : body.tlds.map((tld) => `${body.sld}.${tld}`);
    const uniqueNames = [...new Set(names)];
    const uniquenessFor = createUniquenessResolver();

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
                // FR-05: 独自性スコアは「空き」のときだけ意味を持つ（§10.4 の例に準拠）
                uniqueness: result.available ? uniquenessFor(name) : null,
              });
            } else {
              resultByName.set(name, {
                name,
                registry: adapter.id,
                availability: "error",
                // AC-05-2: スコア算出はレジストリ通信と独立しているので、
                // check が失敗した行でもスコアは返す（ui-screens §Unknown バリアント）
                uniqueness: uniquenessFor(name),
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
              // AC-05-2: レジストリ障害時もスコアは表示する
              uniqueness: uniquenessFor(name),
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
      throw new ApiException(
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
    // AC-06-1: 成功時点で DB に write-through し、一覧（FR-02）に即時反映する
    const record = await upsertDomainFromInfo(c.get("user").id, domain);
    return c.json(detailResponse(record, false), 201);
  })

  /** FR-07: ドメイン詳細。info で最新化し、失敗時はキャッシュを stale で返す（AC-07-2）。 */
  .get("/:name", async (c) => {
    const name = parseDomainNameParam(c.req.param("name"));
    const userId = c.get("user").id;
    // 未対応 TLD は所有権を引く前に 400 で弾く（入力検証が先）
    const adapter = adapterForDomain(name);
    const cached = await requireOwnedDomain(userId, name);

    // AC-12-5: 移管 OUT 済みの行はレジストリに問い合わせない。
    // 自レジストラがスポンサーではないので `info` の応答を信頼できず（【要確認 §21.2 #12】）、
    // さらに `upsertDomainFromInfo` は常に `ownership = 'owned'` で書くため、
    // 部分一意インデックス（保有中の行のみ）をすり抜けて保有行が復活してしまう。
    if (cached.ownership !== "owned") {
      return c.json(detailResponse(cached, false));
    }

    try {
      const info = await adapter.info(name);
      const record = await upsertDomainFromInfo(userId, info);
      return c.json(detailResponse(record, false));
    } catch (err) {
      if (!(err instanceof RegistryError) || !isTransportFailure(err)) {
        throw err;
      }
      // AC-07-2: レジストリに繋がらないときは最終同期時刻付きでキャッシュを返す
      console.warn(
        JSON.stringify({
          level: "warn",
          requestId: c.get("requestId"),
          message: "info に失敗したため DB キャッシュを返しました",
          domain: name,
          registry: err.registry,
          code: err.code,
        }),
      );
      return c.json(detailResponse(cached, true));
    }
  })

  /** FR-08: 更新（有効期限延長）。curExpDate はレジストリ仕様により必須のため info から取得する。 */
  .post("/:name/renew", jsonValidator(domainRenewRequestSchema), async (c) => {
    const name = parseDomainNameParam(c.req.param("name"));
    const { period } = c.req.valid("json");
    const userId = c.get("user").id;
    const adapter = adapterForDomain(name);
    const owned = await requireOwnedDomain(userId, name, { forWrite: true });

    const current = await adapter.info(name);
    const opCheck = isOperationAllowed("renew", current.statuses, {
      ownership: owned.ownership,
      rgpStatuses: current.rgpStatuses,
    });
    if (!opCheck.allowed) {
      throw new ApiException(
        "OPERATION_NOT_ALLOWED",
        "現在のステータスでは更新できません。",
        {
          statuses: opCheck.blockedBy,
        },
      );
    }
    if (!current.expiresAt) {
      throw new ApiException(
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
    const record = await upsertDomainFromInfo(userId, domain);
    return c.json(detailResponse(record, false));
  })

  /** FR-09: 情報修正（NS・クライアントステータス）。NS は全量指定を差分（add/rem）に変換する。 */
  .patch("/:name", jsonValidator(domainUpdateRequestSchema), async (c) => {
    const name = parseDomainNameParam(c.req.param("name"));
    const body = c.req.valid("json");
    const userId = c.get("user").id;
    const adapter = adapterForDomain(name);
    const owned = await requireOwnedDomain(userId, name, { forWrite: true });

    const current = await adapter.info(name);
    // ロック解除だけの要求は clientUpdateProhibited 中でも許可する（解除経路を残す）
    const unlockOnly =
      body.nameservers === undefined &&
      (body.clientStatuses?.add?.length ?? 0) === 0 &&
      (body.clientStatuses?.remove?.length ?? 0) > 0;
    const opCheck = isOperationAllowed("update", current.statuses, {
      ownership: owned.ownership,
      rgpStatuses: current.rgpStatuses,
      unlockOnly,
    });
    if (!opCheck.allowed) {
      throw new ApiException(
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
      const unchanged = await upsertDomainFromInfo(userId, current);
      return c.json(detailResponse(unchanged, false));
    }

    // AC-18-2: タイムアウト時は info で要求した変更がすべて反映されたかを照合する
    const domain = await reconcileOnTimeout(
      () => adapter.update(name, input),
      async () => {
        const after = await adapter.info(name);
        return isUpdateReflected(after, body) ? after : null;
      },
    );
    const record = await upsertDomainFromInfo(userId, domain);
    return c.json(detailResponse(record, false));
  })

  /** FR-10: 廃止。削除ロック中は実行しない（AC-10-2）。 */
  .delete("/:name", async (c) => {
    const name = parseDomainNameParam(c.req.param("name"));
    const userId = c.get("user").id;
    const adapter = adapterForDomain(name);
    const owned = await requireOwnedDomain(userId, name, { forWrite: true });

    const current = await adapter.info(name);
    const opCheck = isOperationAllowed("delete", current.statuses, {
      ownership: owned.ownership,
      rgpStatuses: current.rgpStatuses,
    });
    if (!opCheck.allowed) {
      throw new ApiException(
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

    // 削除後の状態（RGP 等）を読み直す。ここで例外が出ても廃止自体は成立している点に注意。
    let domain: DomainInfo;
    try {
      domain = await adapter.info(name);
    } catch (err) {
      if (err instanceof RegistryError && err.code === "NOT_FOUND") {
        // 即時削除。レジストリから消えたので保有一覧からも外す（同名の再取得を妨げない）
        await removeDomain(name);
        return c.json({ domain: null, summary: null, stale: false });
      }
      if (err instanceof RegistryError && isTransportFailure(err)) {
        // 繋がらないだけ。廃止は成立しているのに行を消すと RGP 中のドメインが
        // 一覧から消えて復旧導線（FR-11）を失うため、キャッシュを stale で返す
        return c.json(detailResponse(owned, true));
      }
      throw err;
    }
    // AC-10-1: RGP バッジを一覧に出すため削除後の状態も write-through する
    const record = await upsertDomainFromInfo(userId, domain);
    return c.json(detailResponse(record, false));
  })

  /** FR-11: 復旧（RGP restore）。redemptionPeriod 中のみ実行できる（AC-11-2）。 */
  .post("/:name/restore", async (c) => {
    const name = parseDomainNameParam(c.req.param("name"));
    const userId = c.get("user").id;
    const adapter = adapterForDomain(name);
    await requireOwnedDomain(userId, name, { forWrite: true });

    const current = await adapter.info(name);
    if (!isRestorable(current.rgpStatuses, current.statuses)) {
      throw new ApiException(
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
    const record = await upsertDomainFromInfo(userId, domain);
    return c.json(detailResponse(record, false));
  })

  /**
   * FR-12: 移管 OUT 用 AuthCode。info には含まれないため rotate-auth-info で再生成する。
   * 再発行という副作用があるため POST（§10.1）。GET だと Origin 検証（§10.2）を通らない。
   */
  .post("/:name/auth-code", async (c) => {
    const name = parseDomainNameParam(c.req.param("name"));
    const adapter = adapterForDomain(name);
    const owned = await requireOwnedDomain(c.get("user").id, name, {
      forWrite: true,
    });

    const current = await adapter.info(name);
    const opCheck = isOperationAllowed("authCode", current.statuses, {
      ownership: owned.ownership,
      rgpStatuses: current.rgpStatuses,
    });
    if (!opCheck.allowed) {
      throw new ApiException(
        "OPERATION_NOT_ALLOWED",
        "現在のステータスでは AuthCode を発行できません。",
        { statuses: opCheck.blockedBy },
      );
    }

    const authCode = await adapter.authCode(name);
    // 取得のたびに authInfo が再生成される（前回表示した値は無効になる）
    return c.json({ authCode, rotated: true });
  });
