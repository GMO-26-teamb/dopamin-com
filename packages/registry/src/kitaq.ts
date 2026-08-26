import { randomUUID } from "node:crypto";
import {
  type CheckResult,
  type CreateInput,
  DEFAULT_REGISTRANT_PROFILE,
  type DeleteResult,
  type DomainInfo,
  type HelloResult,
  type PollMessage,
  type PollMessageType,
  type RenewInput,
  type TransferResult,
  type TransferStatus,
  type UpdateInput,
} from "@dopamin/shared";
import { z } from "zod";
import type { RegistryAdapter } from "./adapter";
import type { EppEnvelope } from "./envelope";
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

/**
 * DomainTransferResponse。kitaqnic だけが `reDate`（必須）/ `acDate`（任意）を返し、
 * kitaqsign はどちらも持たない（両 openapi.json で確認）。共通実装 1 本で両方を受けるため
 * nullish にする。新有効期限に相当する `exDate` はどちらの応答にも無い。
 */
const transferResDataSchema = z.looseObject({
  domain: z.string(),
  status: z.string(),
  gainingRegistrar: z.string().nullish(),
  losingRegistrar: z.string().nullish(),
  reDate: z.string().nullish(),
  acDate: z.string().nullish(),
});
type TransferResData = z.infer<typeof transferResDataSchema>;

/**
 * `PollResponse` / `PollMessageDto`。**形は両レジストリで完全に同一**
 * （両 openapi.json で確認。差はエンドポイントだけ。docs/registry/spec-notes.md §2）。
 *
 * `id` は int64 宣言だが、JSON 数値の精度落ちを避けたい呼び出し側が文字列で返す実装も
 * 想定して number / string の両方を受け、`PollMessage.id` では string に正規化する
 * （ADR-0002 決定 8）。`payload` は中身が未確定【要確認: §21.2 #13】なので、
 * 想定外の形で Poll ごと落とさないよう `unknown` のまま受けて後段で緩く読む。
 */
export const pollResDataSchema = z.looseObject({
  count: z.number().int(),
  message: z
    .looseObject({
      id: z.union([z.number(), z.string()]),
      msgType: z.string(),
      payload: z.unknown(),
      qdate: z.string(),
    })
    .nullish(),
});
type PollResData = z.infer<typeof pollResDataSchema>;

/**
 * 読めたら string、欠けていても型が想定外でも undefined に倒すフィールド。
 *
 * `.catch()` が要る理由: `looseObject` が許すのは**未知キー**だけで、既知キーの型が
 * 想定外だとオブジェクト全体の parse が失敗する。`payload` の中身は未確定
 * 【要確認: §21.2 #13】なので、1 フィールドの型ずれ（例: `status` が
 * `domain:info` と同じ配列で来る、日付が epoch 数値で来る）で `domain` まで
 * 巻き添えに捨ててしまう。フィールド単位で倒せば読めた分は残る。
 */
const loosePayloadString = z.string().nullish().catch(undefined);

/**
 * `PollMessageDto.payload` から読み取れたら使うフィールド。
 * `DomainTransferResponse` と同じ形で届く前提を置きつつ、欠けていても
 * 型が違っても落とさない。読めなかった情報は `raw`（エンベロープ）側に残る。
 */
const pollPayloadSchema = z.looseObject({
  domain: loosePayloadString,
  name: loosePayloadString,
  status: loosePayloadString,
  gainingRegistrar: loosePayloadString,
  losingRegistrar: loosePayloadString,
  reDate: loosePayloadString,
  acDate: loosePayloadString,
});
type PollPayload = z.infer<typeof pollPayloadSchema>;

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
    // 両レジストリの info 応答に clID 相当のフィールドが無い【要確認: §21.2 #12】。
    // 実測で判明したら domainResDataSchema に足してここでマップする（ADR-0002）。
    sponsoringRegistrarId: null,
    rgpStatuses: resData.rgpStatus,
  };
}

/**
 * レジストリの生の移管ステータス → 正規化ステータス。対応づかなければ null。
 *
 * 両レジストリの OpenAPI は `status` / `msgType` を `string` としか書いておらず enum も
 * 例も無い【要確認: §21.2 #13】ため、EPP（RFC 5731）の trStatus 語彙
 * （pending / clientApproved / serverApproved / clientRejected / clientCancelled /
 * serverCancelled）を前提に部分一致で寄せる。生値は registryStatus に必ず残す。
 *
 * 「対応づかなかった」を呼び出し側が扱えるよう null を返す（倒す先は文脈で違う:
 * transfer 応答は呼んだ操作、Poll は payload の status → `'unknown'`）。
 */
function matchTransferStatus(raw: string): TransferStatus | null {
  const normalized = raw.toLowerCase();
  if (normalized.includes("approve")) {
    return "approved";
  }
  if (normalized.includes("reject")) {
    return "rejected";
  }
  if (normalized.includes("cancel")) {
    return "cancelled";
  }
  // pending は fallback より優先する（approve 応答が pending を返したら pending のまま扱う）
  if (normalized.includes("pending")) {
    return "pending";
  }
  return null;
}

/**
 * 未知値は例外にせず `fallback` に倒す（移管の応答そのものを落とさないため）。
 * `fallback` は呼んだ操作から決まる期待値で、request なら pending、
 * approve / reject / cancel ならその操作の結果。成功応答が返っている以上、
 * 「何が起きたか」はレジストリの語彙より呼んだ操作の方が確かなため。
 */
function toTransferStatus(
  raw: string,
  fallback: TransferStatus,
): TransferStatus {
  return matchTransferStatus(raw) ?? fallback;
}

/** 正規化した移管ステータス → Poll 通知の種別（どちらも正規化側の語彙）。 */
const POLL_TYPE_BY_TRANSFER_STATUS: Record<TransferStatus, PollMessageType> = {
  pending: "transfer_request",
  approved: "transfer_approved",
  rejected: "transfer_rejected",
  cancelled: "transfer_cancelled",
  // 「移管中でない」は transferQuery の導出専用の値で、通知としては意味を持たない
  none: "unknown",
};

/**
 * `msgType` が移管通知だと言っているか。
 *
 * `transfer` のほかに `trn` も見るのは、EPP（RFC 5730 / 5731）の Poll 応答が
 * `<domain:trnData>` で移管を伝えるため。`msgType` がその要素名に寄った値
 * （`trnData` 等）で来ても取りこぼさない。
 */
function looksLikeTransferMsgType(msgType: string): boolean {
  const normalized = msgType.toLowerCase();
  return normalized.includes("transfer") || normalized.includes("trn");
}

/**
 * payload が移管通知の形（`DomainTransferResponse` 相当）か。
 *
 * `gainingRegistrar` / `losingRegistrar` / `reDate` / `acDate` は移管応答にしか無い
 * フィールドなので、`msgType` が読めないときの判断材料になる。`status` は
 * ドメインのライフサイクル通知でも使われうるため、ここでは根拠にしない。
 */
function looksLikeTransferPayload(payload: PollPayload | null): boolean {
  if (payload === null) {
    return false;
  }
  return Boolean(
    payload.gainingRegistrar ??
      payload.losingRegistrar ??
      payload.reDate ??
      payload.acDate,
  );
}

/**
 * `msgType` + `payload` → 正規化した Poll 種別（ADR-0002 決定 9）。
 *
 * `msgType` の値域は未確定【要確認: §21.2 #13】。拾いたいのは移管系の通知だけなので、
 * まず `msgType` か payload の形で移管通知だと分かるかを見る。分からなければ
 * `'unknown'`（捨てずに持ち上げる）。
 *
 * **`status` を先に見ない**のが要点: `matchTransferStatus` は部分一致なので、
 * 移管と無関係な通知の `pendingDelete` / `pendingRestore` 等を移管として拾ってしまう。
 * 種別は消費側（#58）が `transfers` 行を作る根拠になるため、取りこぼし（`'unknown'` は
 * `domainName` / `registryStatus` / `raw` を残す非破壊の逃げ道）より捏造の方が高くつく。
 */
function toPollMessageType(
  msgType: string,
  payload: PollPayload | null,
): PollMessageType {
  if (
    !looksLikeTransferMsgType(msgType) &&
    !looksLikeTransferPayload(payload)
  ) {
    return "unknown";
  }
  const normalized = msgType.toLowerCase();
  if (normalized.includes("approv")) {
    return "transfer_approved";
  }
  if (normalized.includes("reject")) {
    return "transfer_rejected";
  }
  if (normalized.includes("cancel")) {
    return "transfer_cancelled";
  }
  if (normalized.includes("req")) {
    return "transfer_request";
  }
  // 動詞が読めない（`"domain:transfer"` 等）ときだけ payload の status に降りる
  const status = payload?.status ? matchTransferStatus(payload.status) : null;
  return status === null ? "unknown" : POLL_TYPE_BY_TRANSFER_STATUS[status];
}

/** 通知の種別 → その通知が表す移管ステータス。移管通知でなければ null。 */
function transferStatusForPollType(
  type: PollMessageType,
): TransferStatus | null {
  switch (type) {
    case "transfer_request":
      return "pending";
    case "transfer_approved":
      return "approved";
    case "transfer_rejected":
      return "rejected";
    case "transfer_cancelled":
      return "cancelled";
    default:
      return null;
  }
}

/**
 * `DomainTransferResponse` → 正規化 `TransferResult`（request / approve / reject / cancel 共通）。
 *
 * `newExpiresAt` は設定しない: 両レジストリの transfer 応答に `exDate` が無く、
 * 埋めるには移管後の `info` 追い読みが要る（ADR-0002 / §11.1）。
 * `raw` にはエンベロープごと入れる（障害調査で svTRID を突合できるように）。
 */
function toTransferResult(
  resData: TransferResData,
  envelope: EppEnvelope,
  fallbackStatus: TransferStatus,
): TransferResult {
  return {
    name: resData.domain.toLowerCase(),
    status: toTransferStatus(resData.status, fallbackStatus),
    registryStatus: resData.status,
    requestingRegistrarId: resData.gainingRegistrar ?? undefined,
    actingRegistrarId: resData.losingRegistrar ?? undefined,
    requestedAt: resData.reDate ?? undefined,
    actByAt: resData.acDate ?? undefined,
    raw: envelope,
  };
}

/**
 * `PollResponse` → 正規化 `PollMessage`（ADR-0002 決定 8 / 9）。通知が無ければ null。
 *
 * `payload` の中身は未確定【要確認: §21.2 #13】なので、`DomainTransferResponse` と同じ形で
 * 届く前提で緩く読み、読めなかったフィールドは**そのフィールドだけ**落とす
 * （`payload` がオブジェクトですらない場合のみ全体を諦める。`raw` にはエンベロープごと残る）。
 * `registryStatus` は payload の `status`、無ければ生の `msgType` を入れる
 * （正規化で潰れた情報の復元元になるのはこの 2 つだけのため）。
 */
function toPollMessage(
  resData: PollResData,
  envelope: EppEnvelope,
): PollMessage | null {
  const message = resData.message;
  if (!message) {
    return null;
  }
  const parsed = pollPayloadSchema.safeParse(message.payload);
  const payload = parsed.success ? parsed.data : null;
  const rawStatus = payload?.status ?? undefined;
  const type = toPollMessageType(message.msgType, payload);
  const domainName = (payload?.domain ?? payload?.name)?.toLowerCase();
  const transferStatus = transferStatusForPollType(type);
  const transfer: TransferResult | undefined =
    transferStatus === null || domainName === undefined
      ? undefined
      : {
          name: domainName,
          status: transferStatus,
          registryStatus: rawStatus ?? message.msgType,
          ...(payload?.gainingRegistrar
            ? { requestingRegistrarId: payload.gainingRegistrar }
            : {}),
          ...(payload?.losingRegistrar
            ? { actingRegistrarId: payload.losingRegistrar }
            : {}),
          ...(payload?.reDate ? { requestedAt: payload.reDate } : {}),
          ...(payload?.acDate ? { actByAt: payload.acDate } : {}),
          raw: envelope,
        };
  return {
    id: String(message.id),
    count: resData.count,
    queuedAt: message.qdate,
    type,
    ...(domainName === undefined ? {} : { domainName }),
    ...(transfer === undefined ? {} : { transfer }),
    raw: envelope,
  };
}

class KitaqRegistryAdapter implements RegistryAdapter {
  readonly id: KitaqAdapterConfig["id"];
  /** `X-Registrar-Id` に送っている自レジストラ ID（§11.1 / ADR-0002 決定 3）。 */
  readonly registrarId: string;
  readonly specVersion = SPEC_VERSION;
  private readonly client: KitaqHttpClient;

  constructor(config: KitaqAdapterConfig) {
    this.id = config.id;
    this.registrarId = config.registrarId;
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
  private async ensureHosts(
    hostNames: string[],
    domainName: string,
  ): Promise<void> {
    for (const host of hostNames) {
      try {
        await this.client.command({
          method: "GET",
          path: `/hosts/${encodeURIComponent(host)}`,
          kind: "read",
          command: "host_info",
          // ホスト操作だが、操作ログでは起点となったドメインに紐づける
          domainName,
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
          command: "host_create",
          domainName,
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

  /** `info` を生エンベロープ付きで取る（transferQuery が raw に載せるため）。 */
  private async infoWithEnvelope(
    name: string,
  ): Promise<{ info: DomainInfo; envelope: EppEnvelope }> {
    const { resData, envelope } = await this.client.command({
      method: "GET",
      path: `/domains/${encodeURIComponent(name)}`,
      kind: "read",
      command: "info",
      domainName: name,
      resDataSchema: domainResDataSchema,
    });
    return { info: toDomainInfo(this.id, resData), envelope };
  }

  async info(name: string): Promise<DomainInfo> {
    const { info } = await this.infoWithEnvelope(name);
    return info;
  }

  async create(input: CreateInput): Promise<DomainInfo> {
    // registrant は既存コンタクト ID の参照が必須のため、先にダミー PII でコンタクトを作る。
    // ネームサーバも update と同様にホストオブジェクトを先に用意しておく。
    if (input.nameservers && input.nameservers.length > 0) {
      await this.ensureHosts(input.nameservers, input.name);
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
      command: "contact_create",
      // コンタクト操作だが、操作ログでは登録対象のドメインに紐づける
      domainName: input.name,
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
      domainName: input.name,
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
      domainName: name,
      resDataSchema: renewResDataSchema,
    });
    return this.info(name);
  }

  async update(name: string, input: UpdateInput): Promise<DomainInfo> {
    if (input.addNameservers && input.addNameservers.length > 0) {
      await this.ensureHosts(input.addNameservers, name);
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
      domainName: name,
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
      domainName: name,
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
      domainName: name,
      resDataSchema: unitResDataSchema,
    });
    return this.info(name);
  }

  async transferRequest(
    name: string,
    authCode: string,
  ): Promise<TransferResult> {
    const { resData, envelope } = await this.client.command({
      method: "POST",
      path: `/domains/${encodeURIComponent(name)}/transfer/request`,
      body: { op: "request", authInfo: authCode },
      kind: "write",
      command: "transfer_request",
      domainName: name,
      resDataSchema: transferResDataSchema,
    });
    return toTransferResult(resData, envelope, "pending");
  }

  /**
   * approve / reject / cancel の共通実装。3 つともパス末尾だけが違い、
   * 応答は request と同じ `DomainTransferResponse`（両 openapi.json で確認）。
   *
   * ボディは送らない: 両レジストリの OpenAPI は `transfer/request` にだけ `requestBody`
   * （`DomainTransferRequest { op, authInfo?, period? }`）を宣言していて、
   * approve / reject / cancel には無い。`restore` / `rotate-auth-info` と同じ
   * 「requestBody を宣言しないエンドポイントにはボディを送らない」流儀に揃える。
   * 実レジストリが 400 / 2001（Malformed JSON）や必須ボディ欠落で拒否するようなら、
   * `body: { op }`（`DomainTransferRequest.op` の enum には approve / reject / cancel がある）を
   * 付けて Swagger 側の欠落として spec-notes に記録する。
   */
  private async transferAct(
    name: string,
    op: "approve" | "reject" | "cancel",
    command: "transfer_approve" | "transfer_reject" | "transfer_cancel",
    fallbackStatus: TransferStatus,
  ): Promise<TransferResult> {
    const { resData, envelope } = await this.client.command({
      method: "POST",
      path: `/domains/${encodeURIComponent(name)}/transfer/${op}`,
      kind: "write",
      command,
      domainName: name,
      resDataSchema: transferResDataSchema,
    });
    return toTransferResult(resData, envelope, fallbackStatus);
  }

  async transferApprove(name: string): Promise<TransferResult> {
    return this.transferAct(name, "approve", "transfer_approve", "approved");
  }

  async transferReject(name: string): Promise<TransferResult> {
    return this.transferAct(name, "reject", "transfer_reject", "rejected");
  }

  async transferCancel(name: string): Promise<TransferResult> {
    return this.transferAct(name, "cancel", "transfer_cancel", "cancelled");
  }

  async transferQuery(name: string): Promise<TransferResult> {
    // transfer query の専用エンドポイントが無いため info のステータスから導出する。
    // 導出元なので raw には info のエンベロープが入る。レジストラ ID・申請日時は
    // info からは取れないため undefined のまま（approved / rejected / cancelled の
    // 区別も付かないので、状態遷移の把握は Poll が主になる。ADR-0002）。
    const { info, envelope } = await this.infoWithEnvelope(name);
    return {
      name: info.name,
      status: info.statuses.includes("pendingTransfer") ? "pending" : "none",
      raw: envelope,
    };
  }

  async authCode(name: string): Promise<string> {
    const { resData } = await this.client.command({
      method: "POST",
      path: `/domains/${encodeURIComponent(name)}/rotate-auth-info`,
      kind: "write",
      command: "auth_info",
      domainName: name,
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

  /**
   * 最古の未 ack 通知を 1 件取得する（無ければ null）。
   * エンドポイントだけがレジストリで違う（kitaqsign は `GET /messages/poll`、
   * kitaqnic は `GET /messages`）。応答の形（`PollResponse`）は同一（spec-notes §2）。
   */
  async poll(): Promise<PollMessage | null> {
    const { resData, envelope } = await this.client.command({
      method: "GET",
      path: this.id === "kitaqsign" ? "/messages/poll" : "/messages",
      kind: "read",
      command: "poll",
      // 対象ドメインは payload を読むまで分からないので操作ログでは紐づけない（§9.1 は null 可）
      resDataSchema: pollResDataSchema,
    });
    return toPollMessage(resData, envelope);
  }

  /**
   * 通知の消し込み。kitaqsign は `POST /messages/{id}/ack`、kitaqnic は
   * `DELETE /messages/{id}`（spec-notes §2）。応答はどちらも `EppResponseUnit`。
   * ack しない限り同じメッセージが返り続けるため、Poll 消化の最後に必ず呼ぶ。
   */
  async ackMessage(id: string): Promise<void> {
    const messageId = this.messageIdForPath(id);
    const isKitaqsign = this.id === "kitaqsign";
    await this.client.command({
      method: isKitaqsign ? "POST" : "DELETE",
      path: isKitaqsign
        ? `/messages/${messageId}/ack`
        : `/messages/${messageId}`,
      kind: "write",
      command: "ack",
      resDataSchema: unitResDataSchema,
    });
  }

  /**
   * ack のパスパラメータは int64。`PollMessage.id` は桁落ちを避けるため string に
   * 正規化した値（ADR-0002 決定 8）なので、URL に埋める前に整数表記かを確かめる。
   * 整数でない値は正規化の前提が崩れている（= 仕様変更の疑い）ため
   * REGISTRY_SPEC_MISMATCH で落とし、404 を引きに行かない。
   */
  private messageIdForPath(id: string): string {
    if (!/^\d+$/.test(id)) {
      throw new RegistryError({
        code: "REGISTRY_SPEC_MISMATCH",
        registry: this.id,
        message: "ack: メッセージ ID が整数ではありません",
        reason: `id=${id}`,
      });
    }
    return id;
  }
}

/** kitaqsign / kitaqnic 向けの実レジストリアダプタを生成する。 */
export function createKitaqAdapter(
  config: KitaqAdapterConfig,
): RegistryAdapter {
  return new KitaqRegistryAdapter(config);
}
