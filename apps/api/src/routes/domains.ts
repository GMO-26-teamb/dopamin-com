import { randomBytes } from "node:crypto";
import { RegistryError } from "@dopamin/registry";
import {
  type DomainDetailResponse,
  type DomainInfo,
  domainCheckRequestSchema,
  domainCreateRequestSchema,
  domainRenewRequestSchema,
  domainUpdateRequestSchema,
  isOperationAllowed,
  isRestorable,
  REGISTRY_CONTACT_KEY,
  type RegistrantProfile,
  type SubdomainPlanSummary,
  type UpdateInput,
} from "@dopamin/shared";
import { Hono } from "hono";
import { getDb } from "../lib/db";
import { ApiException } from "../lib/errors";
import { parseDomainNameParam } from "../lib/params";
import { reconcileOnTimeout } from "../lib/reconcile";
import { adapterForDomain } from "../lib/registries";
import { registryErrorMessage } from "../lib/registry-message";
import { withReadRetry } from "../lib/retry";
import { jsonValidator } from "../lib/validator";
import { requireSession } from "../middleware/session";
import { checkDomains } from "../services/check.service";
import {
  ensureRegistryContact,
  getContactStore,
} from "../services/contact.service";
import {
  listDomainSummaries,
  pendingTransfersByDomain,
  removeDomain,
  requireOwnedDomain,
  toDomainSummary,
  upsertDomainFromInfo,
} from "../services/domain.service";
import type { DomainRecord } from "../services/domain-store";
import { syncDomainsAndConsumePoll } from "../services/poll.service";
import { getSubdomainPlanSummary } from "../services/subdomain-plan.service";
import type { TransferRecord } from "../services/transfer-store";
import type { AuthedEnv } from "../types";
import { subdomainPlan } from "./subdomain-plan";

/** 登録時の authInfo を自動生成する（RFC 9154: 128bit 以上のエントロピー推奨）。 */
function generateAuthInfo(): string {
  return randomBytes(24).toString("base64url");
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

/** 要求した NS 全量が info に出ているか。 */
function areNameserversReflected(
  after: DomainInfo,
  desired: readonly string[],
): boolean {
  const wanted = new Set(desired);
  const actual = new Set(after.nameservers.map((ns) => ns.toLowerCase()));
  return (
    wanted.size === actual.size && [...wanted].every((ns) => actual.has(ns))
  );
}

/**
 * 要求したロックの付与・解除が info に出ているか。
 * 付け外しを 1 件も要求していなければ「照合材料が無い」= false。
 */
function areClientStatusesReflected(
  after: DomainInfo,
  change: { add?: string[]; remove?: string[] } | undefined,
): boolean {
  const add = change?.add ?? [];
  const remove = change?.remove ?? [];
  if (add.length === 0 && remove.length === 0) {
    return false;
  }
  const statuses = new Set(after.statuses);
  return (
    add.every((status) => statuses.has(status)) &&
    remove.every((status) => !statuses.has(status))
  );
}

/**
 * AC-18-2 の照合条件: 要求した変更が info に反映されているか。
 *
 * EPP の `update` は 1 コマンドなので、**`info` から確かめられる項目が 1 つでも
 * 反映されていれば全体が成立している**。逆に確かめられる項目が 1 つも無ければ
 * 偽の成功にせず 504 のままにする。
 *
 * - NS: 全量が一致するか
 * - ロック: 2026-08-27 の運営修正で `info` に出るようになった（spec-notes §3 #10）ので
 *   照合できる。ロックだけの要求（D-02 のトグル単体・#205）もこれで確定する。
 *   kitaqsign は未実測なので、NS が確認できていれば status は問わない
 * - コンタクト: `info` は ID しか返さず、変更前後で同じ ID を使い回すため照合材料にならない
 */
function isUpdateReflected(
  after: DomainInfo,
  body: {
    nameservers?: string[];
    clientStatuses?: { add?: string[]; remove?: string[] };
  },
): boolean {
  if (
    body.nameservers !== undefined &&
    areNameserversReflected(after, body.nameservers)
  ) {
    return true;
  }
  return areClientStatusesReflected(after, body.clientStatuses);
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
 * 詳細レスポンス（FR-07。契約は `domainDetailResponseSchema`）。
 * `domain` は正規化済み `info`、`summary` は一覧と同じ要約、
 * `registrantProfile` は登録者コンタクトの中身（{@link registrantProfileFor}）、
 * `subdomainPlan` は保存済み設計の件数（{@link subdomainPlanSummaryFor}）。
 * `stale = true` はレジストリに繋がらず DB キャッシュを返したことを示し（AC-07-2）、
 * `error` にその理由が入る。
 */
async function detailResponse(
  record: DomainRecord,
  stale: boolean,
  options: {
    transfer?: TransferRecord;
    error?: DomainDetailResponse["error"];
  } = {},
): Promise<DomainDetailResponse> {
  // 互いに独立した 2 つの引き当て（コンタクト / 設計）なので直列に待たない
  const [registrantProfile, subdomainPlan] = await Promise.all([
    registrantProfileFor(record),
    subdomainPlanSummaryFor(record),
  ]);
  return {
    domain: record.info,
    summary: toDomainSummary(record, stale, options.transfer),
    registrantProfile,
    subdomainPlan,
    stale,
    syncedAt: record.syncedAt.toISOString(),
    ...(options.error ? { error: options.error } : {}),
  };
}

/**
 * 保存済みサブドメイン設計の件数（FR-13 → 詳細のカード。#217）。
 *
 * `subdomain_plans` は `domains.id` を FK に持つので、行 ID が無いレコード
 * （まだ DB に書いていない = レジストリ応答から組み立てただけの値）では引けない。
 * その場合は「設計が無い」ではなく「まだ引けない」なので、単に null を返す
 * （`requireOwnedDomainId` のように 500 にはしない: 詳細表示は ID が無くても成立する）。
 */
async function subdomainPlanSummaryFor(
  record: DomainRecord,
): Promise<SubdomainPlanSummary | null> {
  return record.id === null
    ? null
    : await getSubdomainPlanSummary(getDb(), record.id);
}

/**
 * `domain.registrant`（レジストリのコンタクト ID）が指す登録者プロファイル（FR-07 / FR-09）。
 *
 * `info` は ID しか返さないので、画面が氏名・メールを出すにはアプリが `contacts` に
 * 持っている中身を添える必要がある。参照先がアプリのコンタクトでなければ中身を知らないため
 * `null` にする（移管 IN 直後は相手レジストラの ID を参照したまま。推測で自分のものを出さない）。
 */
async function registrantProfileFor(
  record: DomainRecord,
): Promise<RegistrantProfile | null> {
  const contact = await getContactStore().find(
    record.userId,
    record.registry,
    "registrant",
  );
  return contact !== null &&
    contact.registryContactId === record.info.registrant
    ? contact.profile
    : null;
}

/** 詳細で返す移管バッジ用に、そのドメインの進行中の移管を引く（FR-12 / AC-07-3）。 */
async function pendingTransferFor(
  userId: string,
  name: string,
): Promise<TransferRecord | undefined> {
  return (await pendingTransfersByDomain(userId)).get(name);
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
    return c.json({ results: await checkDomains(names) });
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

    // FR-06「登録者プロファイルを自動適用」: ユーザー × レジストリで 1 件のコンタクトを
    // 用意して使い回す（未作成なら contact:create）。#72
    //
    // S-25 で登録者を指定したときは PATCH と同じ経路でそのプロファイルを使う
    // （＝既存コンタクトがあれば contact:update で中身を差し替える）。
    // 省略時は既定プロファイル（`DEFAULT_REGISTRANT_PROFILE`）のまま（従来どおり）。
    const registrantContactId = await ensureRegistryContact(
      c.get("user").id,
      adapter,
      "registrant",
      body.contacts?.registrant,
    );

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
          registrantContactId,
        }),
      () => adapter.info(body.name),
    );
    // AC-06-1: 成功時点で DB に write-through し、一覧（FR-02）に即時反映する
    const record = await upsertDomainFromInfo(c.get("user").id, domain);
    return c.json(await detailResponse(record, false), 201);
  })

  /** FR-07: ドメイン詳細。info で最新化し、失敗時はキャッシュを stale で返す（AC-07-2）。 */
  .get("/:name", async (c) => {
    const name = parseDomainNameParam(c.req.param("name"));
    const userId = c.get("user").id;
    // 未対応 TLD は所有権を引く前に 400 で弾く（入力検証が先）
    const adapter = adapterForDomain(name);
    const cached = await requireOwnedDomain(userId, name);

    const transfer = await pendingTransferFor(userId, name);

    // AC-12-5: 移管 OUT 済みの行はレジストリに問い合わせない。
    // 自レジストラがスポンサーではないので `info` の応答を信頼できず（【要確認 §21.2 #12】）、
    // さらに `upsertDomainFromInfo` は常に `ownership = 'owned'` で書くため、
    // 部分一意インデックス（保有中の行のみ）をすり抜けて保有行が復活してしまう。
    if (cached.ownership !== "owned") {
      return c.json(await detailResponse(cached, false, { transfer }));
    }

    try {
      const info = await withReadRetry(() => adapter.info(name));
      const record = await upsertDomainFromInfo(userId, info);
      return c.json(await detailResponse(record, false, { transfer }));
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
      return c.json(
        await detailResponse(cached, true, {
          transfer,
          error: { code: err.code, message: registryErrorMessage(err) },
        }),
      );
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
    return c.json(await detailResponse(record, false));
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
    // FR-09: コンタクトは ID の参照でしか指定できないので、先に用意して ID に変換する。
    // 同じ ID を使い回すため、内容だけが変わった場合はレジストリ側で contact:update になる
    if (body.contacts?.registrant) {
      input.registrant = await ensureRegistryContact(
        userId,
        adapter,
        "registrant",
        body.contacts.registrant,
      );
    }
    if (body.contacts?.tech) {
      input.contacts = {
        [REGISTRY_CONTACT_KEY.tech]: await ensureRegistryContact(
          userId,
          adapter,
          "tech",
          body.contacts.tech,
        ),
      };
    }

    const hasChanges =
      (input.addNameservers?.length ?? 0) > 0 ||
      (input.removeNameservers?.length ?? 0) > 0 ||
      (input.addStatuses?.length ?? 0) > 0 ||
      (input.removeStatuses?.length ?? 0) > 0 ||
      input.registrant !== undefined ||
      input.contacts !== undefined;
    if (!hasChanges) {
      const unchanged = await upsertDomainFromInfo(userId, current);
      return c.json(await detailResponse(unchanged, false));
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
    return c.json(await detailResponse(record, false));
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
        return c.json(await detailResponse(owned, true));
      }
      throw err;
    }
    // AC-10-1: RGP バッジを一覧に出すため削除後の状態も write-through する
    const record = await upsertDomainFromInfo(userId, domain);
    return c.json(await detailResponse(record, false));
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
    return c.json(await detailResponse(record, false));
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
  })

  /**
   * FR-13（サブドメイン設計）は関心が違うので別ファイルに置き、ここへネストする。
   * `index.ts` で同じ `/domains` に 2 本重ねると `use(requireSession)` が
   * 両方 `ALL /domains/*` として登録され、FR-13 のルートだけセッション検証が
   * 2 回走る（#166）。ネストなら上の `.use(requireSession)` が 1 回だけ効く。
   */
  .route("/", subdomainPlan);
