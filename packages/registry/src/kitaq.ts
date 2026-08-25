import { randomUUID } from "node:crypto";
import {
  type CheckResult,
  type CreateInput,
  DEFAULT_REGISTRANT_PROFILE,
  type DeleteResult,
  type DomainInfo,
  type HelloResult,
  type RenewInput,
  type TransferResult,
  type UpdateInput,
} from "@dopamin/shared";
import { z } from "zod";
import type { RegistryAdapter } from "./adapter";
import { RegistryError } from "./errors";
import { type KitaqAdapterConfig, KitaqHttpClient } from "./http";

/** Swagger 取得日（docs/registry/*.openapi.json）。仕様変更時に更新し /health で確認できるようにする。 */
const SPEC_VERSION = "v1 (2026-08-25)";

// ---- resData スキーマ（未知フィールドは許容、必須欠落は REGISTRY_SPEC_MISMATCH）----
// 契約テスト（envelope.test.ts）が fixture を本番スキーマで検証できるよう export する。

export const domainResDataSchema = z.looseObject({
  domain: z.string(),
  status: z.array(z.string()),
  registrant: z.string(),
  contacts: z.record(z.string(), z.string()),
  nameservers: z.array(z.string()),
  crDate: z.string(),
  upDate: z.string().nullish(),
  exDate: z.string().nullish(),
  trDate: z.string().nullish(),
  rgpStatus: z.array(z.string()),
});
type DomainResData = z.infer<typeof domainResDataSchema>;

export const checkResDataSchema = z.looseObject({
  results: z.array(
    z.looseObject({
      name: z.string(),
      avail: z.boolean(),
      reason: z.string().nullish(),
    }),
  ),
});

const createResDataSchema = z.looseObject({
  domain: z.string(),
  crDate: z.string(),
  exDate: z.string(),
});

const renewResDataSchema = z.looseObject({
  domain: z.string(),
  exDate: z.string(),
});

const transferResDataSchema = z.looseObject({
  domain: z.string(),
  status: z.string(),
  gainingRegistrar: z.string().nullish(),
  losingRegistrar: z.string().nullish(),
});

/**
 * hello の resData はレジストリで形が違う:
 * kitaqsign は `{ registryCode, tlds, message }`、kitaqnic は `{ svID, ..., info: { supportedTlds } }`。
 */
export const helloResDataSchema = z.looseObject({
  tlds: z.array(z.string()).nullish(),
  info: z
    .looseObject({
      supportedTlds: z.array(z.string()).nullish(),
    })
    .nullish(),
});

const authInfoResDataSchema = z.record(z.string(), z.string());

const unitResDataSchema = z.unknown();

// ---- ヘルパ ----

/** コンタクト ID: 3〜16 文字・英数字とハイフン・先頭ハイフン不可・レジストラ内で一意。 */
function newContactId(): string {
  return `dp-${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

function toDomainInfo(
  registry: KitaqAdapterConfig["id"],
  resData: DomainResData,
): DomainInfo {
  return {
    name: resData.domain.toLowerCase(),
    registry,
    statuses: resData.status,
    registrant: resData.registrant,
    contacts: resData.contacts,
    nameservers: resData.nameservers,
    registeredAt: resData.crDate,
    updatedAt: resData.upDate ?? null,
    expiresAt: resData.exDate ?? null,
    lastTransferAt: resData.trDate ?? null,
    rgpStatuses: resData.rgpStatus,
  };
}

class KitaqRegistryAdapter implements RegistryAdapter {
  readonly id: KitaqAdapterConfig["id"];
  readonly specVersion = SPEC_VERSION;
  private readonly client: KitaqHttpClient;

  constructor(config: KitaqAdapterConfig) {
    this.id = config.id;
    this.client = new KitaqHttpClient(config);
  }

  async hello(): Promise<HelloResult> {
    const { resData } = await this.client.command({
      method: "GET",
      path: "/sessions/hello",
      kind: "read",
      command: "hello",
      resDataSchema: helloResDataSchema,
    });
    const tlds = resData.tlds ?? resData.info?.supportedTlds ?? [];
    return { registry: this.id, tlds: tlds.map((t) => t.toLowerCase()) };
  }

  /**
   * ネームサーバとして参照するホストオブジェクトを事前に用意する。
   * 実測（2026-08-25）: domain:update はホスト未作成だと 2303（"<host> not found"）で拒否する。
   * 無ければ POST /hosts で作成する（並行作成による 2302 は既存扱いで無視）。
   */
  private async ensureHosts(hostNames: string[]): Promise<void> {
    for (const host of hostNames) {
      try {
        await this.client.command({
          method: "GET",
          path: `/hosts/${encodeURIComponent(host)}`,
          kind: "read",
          command: "host:info",
          resDataSchema: unitResDataSchema,
        });
        continue;
      } catch (err) {
        if (!(err instanceof RegistryError) || err.code !== "NOT_FOUND") {
          throw err;
        }
      }
      try {
        await this.client.command({
          method: "POST",
          path: "/hosts",
          body: { name: host },
          kind: "write",
          command: "host:create",
          resDataSchema: unitResDataSchema,
        });
      } catch (err) {
        if (!(err instanceof RegistryError) || err.code !== "CONFLICT") {
          throw err;
        }
      }
    }
  }

  async check(names: string[]): Promise<CheckResult[]> {
    const { resData } = await this.client.command({
      method: "POST",
      path: "/domains/check",
      body: { names },
      kind: "read",
      command: "check",
      resDataSchema: checkResDataSchema,
    });
    return resData.results.map((r) => ({
      name: r.name.toLowerCase(),
      available: r.avail,
      ...(r.reason ? { reason: r.reason } : {}),
    }));
  }

  async info(name: string): Promise<DomainInfo> {
    const { resData } = await this.client.command({
      method: "GET",
      path: `/domains/${encodeURIComponent(name)}`,
      kind: "read",
      command: "info",
      resDataSchema: domainResDataSchema,
    });
    return toDomainInfo(this.id, resData);
  }

  async create(input: CreateInput): Promise<DomainInfo> {
    // registrant は既存コンタクト ID の参照が必須のため、先にダミー PII でコンタクトを作る。
    // ネームサーバも update と同様にホストオブジェクトを先に用意しておく。
    if (input.nameservers && input.nameservers.length > 0) {
      await this.ensureHosts(input.nameservers);
    }
    const contact = input.contact ?? DEFAULT_REGISTRANT_PROFILE;
    const contactId = newContactId();
    await this.client.command({
      method: "POST",
      path: "/contacts",
      body: {
        id: contactId,
        postalInfo: {
          name: contact.name,
          addr: {
            street: contact.street,
            city: contact.city,
            cc: contact.countryCode,
          },
        },
        email: contact.email,
        authInfo: randomUUID(),
      },
      kind: "write",
      command: "contact:create",
      resDataSchema: unitResDataSchema,
    });

    await this.client.command({
      method: "POST",
      path: "/domains",
      body: {
        domain: input.name,
        period: { unit: "Y", value: input.periodYears },
        ...(input.nameservers && input.nameservers.length > 0
          ? { nameservers: input.nameservers }
          : {}),
        registrant: contactId,
        authInfo: input.authInfo,
      },
      kind: "write",
      command: "create",
      resDataSchema: createResDataSchema,
    });

    // 確定情報（ステータス・RGP 含む）は info で取得して返す
    return this.info(input.name);
  }

  async renew(name: string, input: RenewInput): Promise<DomainInfo> {
    await this.client.command({
      method: "POST",
      path: `/domains/${encodeURIComponent(name)}/renew`,
      body: {
        // レジストリは日付（YYYY-MM-DD）で受ける（Swagger 例: "2027-05-05"）
        curExpDate: input.currentExpiresAt.slice(0, 10),
        period: { unit: "Y", value: input.periodYears },
      },
      kind: "write",
      command: "renew",
      resDataSchema: renewResDataSchema,
    });
    return this.info(name);
  }

  async update(name: string, input: UpdateInput): Promise<DomainInfo> {
    if (input.addNameservers && input.addNameservers.length > 0) {
      await this.ensureHosts(input.addNameservers);
    }
    const add: Record<string, unknown> = {};
    const rem: Record<string, unknown> = {};
    if (input.addNameservers && input.addNameservers.length > 0) {
      add.nameservers = input.addNameservers;
    }
    if (input.addStatuses && input.addStatuses.length > 0) {
      add.statuses = input.addStatuses;
    }
    if (input.removeNameservers && input.removeNameservers.length > 0) {
      rem.nameservers = input.removeNameservers;
    }
    if (input.removeStatuses && input.removeStatuses.length > 0) {
      rem.statuses = input.removeStatuses;
    }

    // レスポンス resData は kitaqsign が DomainResponse、kitaqnic が Unit（空）
    // （Swagger で確認済みの差分）。ドメイン情報が返ればそれを使い、無ければ info で取り直す。
    const { resData } = await this.client.command({
      method: "PUT",
      path: `/domains/${encodeURIComponent(name)}`,
      body: {
        ...(Object.keys(add).length > 0 ? { add } : {}),
        ...(Object.keys(rem).length > 0 ? { rem } : {}),
      },
      kind: "write",
      command: "update",
      resDataSchema: unitResDataSchema,
    });
    const parsed = domainResDataSchema.safeParse(resData);
    if (parsed.success) {
      return toDomainInfo(this.id, parsed.data);
    }
    return this.info(name);
  }

  async delete(name: string): Promise<DeleteResult> {
    await this.client.command({
      method: "DELETE",
      path: `/domains/${encodeURIComponent(name)}`,
      kind: "write",
      command: "delete",
      resDataSchema: unitResDataSchema,
    });
    return { name: name.toLowerCase() };
  }

  async restore(name: string): Promise<DomainInfo> {
    await this.client.command({
      method: "POST",
      path: `/domains/${encodeURIComponent(name)}/restore`,
      kind: "write",
      command: "restore",
      resDataSchema: unitResDataSchema,
    });
    return this.info(name);
  }

  async transferRequest(
    name: string,
    authCode: string,
  ): Promise<TransferResult> {
    const { resData } = await this.client.command({
      method: "POST",
      path: `/domains/${encodeURIComponent(name)}/transfer/request`,
      body: { op: "request", authInfo: authCode },
      kind: "write",
      command: "transfer:request",
      resDataSchema: transferResDataSchema,
    });
    return {
      name: resData.domain.toLowerCase(),
      status: resData.status,
      gainingRegistrar: resData.gainingRegistrar ?? null,
      losingRegistrar: resData.losingRegistrar ?? null,
    };
  }

  async transferQuery(name: string): Promise<TransferResult> {
    // transfer query の専用エンドポイントが無いため info のステータスから導出する
    const info = await this.info(name);
    return {
      name: info.name,
      status: info.statuses.includes("pendingTransfer") ? "pending" : "none",
      gainingRegistrar: null,
      losingRegistrar: null,
    };
  }

  async authCode(name: string): Promise<string> {
    const { resData } = await this.client.command({
      method: "POST",
      path: `/domains/${encodeURIComponent(name)}/rotate-auth-info`,
      kind: "write",
      command: "rotate-auth-info",
      resDataSchema: authInfoResDataSchema,
    });
    const entry = Object.entries(resData).find(
      ([key]) => key.toLowerCase() === "authinfo",
    );
    const authInfo = entry?.[1];
    if (!authInfo) {
      throw new RegistryError({
        code: "REGISTRY_SPEC_MISMATCH",
        registry: this.id,
        message: "rotate-auth-info: resData に authInfo が含まれていません",
        reason: `keys=${Object.keys(resData).join(",")}`,
      });
    }
    return authInfo;
  }
}

/** kitaqsign / kitaqnic 向けの実レジストリアダプタを生成する。 */
export function createKitaqAdapter(
  config: KitaqAdapterConfig,
): RegistryAdapter {
  return new KitaqRegistryAdapter(config);
}
