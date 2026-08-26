import { z } from "zod";

/** レジストリ識別子（docs/requirements.md §11.1）。 */
export const registryIdSchema = z.enum(["kitaqsign", "kitaqnic", "mock"]);
export type RegistryId = z.infer<typeof registryIdSchema>;

/**
 * `domain:update` でレジストラが設定・解除できるクライアント側ステータス
 * （両レジストリ Swagger の DomainChangeSet.statuses enum と一致）。
 */
export const CLIENT_STATUSES = [
  "clientHold",
  "clientTransferProhibited",
  "clientUpdateProhibited",
  "clientDeleteProhibited",
  "clientRenewProhibited",
] as const;

export const clientStatusSchema = z.enum(CLIENT_STATUSES);
export type ClientStatus = z.infer<typeof clientStatusSchema>;

/** EPP `check` の正規化結果。 */
export interface CheckResult {
  name: string;
  available: boolean;
  reason?: string;
}

/** EPP `info` の正規化結果（DB キャッシュ・画面表示の元になる型）。 */
export interface DomainInfo {
  name: string;
  registry: RegistryId;
  /** EPP ステータス（ok / inactive / pendingDelete / client* / server* など）。 */
  statuses: string[];
  /** 登録者コンタクト ID（レジストリ採番側の ID）。 */
  registrant: string;
  /** ロール別コンタクト ID（ADMIN / TECH など）。 */
  contacts: Record<string, string>;
  nameservers: string[];
  /** ISO 8601。レジストリの crDate。 */
  registeredAt: string;
  updatedAt: string | null;
  expiresAt: string | null;
  lastTransferAt: string | null;
  /**
   * 現スポンサーレジストラ（EPP の clID）。自レジストラ ID と一致すれば保有中（§6.5）。
   * 両レジストリの OpenAPI の `info` 応答に相当フィールドが無いため当面は常に null。
   * 実測で判明したらアダプタ側のマッピングだけを足す【要確認: §21.2 #12】。
   */
  sponsoringRegistrarId: string | null;
  /** RGP（RFC 3915）ステータス（addPeriod / redemptionPeriod など）。 */
  rgpStatuses: string[];
}

/**
 * 登録者プロファイル。レジストリは許可されたダミー値しか受け付けない
 * （PII 方針・docs/registry/spec-notes.md「値の制約」参照）。
 */
export interface RegistrantProfile {
  /** 許可ダミー氏名（John Doe / Taro Test など）のみ。 */
  name: string;
  /** `@example.com` / `@example.net` / `@example.org` のみ。 */
  email: string;
  /** `N/A` または `Redacted for Privacy` のみ。 */
  street: string;
  /** `N/A` または `Redacted for Privacy` のみ。 */
  city: string;
  /** `JP` または `US` のみ。 */
  countryCode: "JP" | "US";
}

/** 既定の登録者プロファイル（レジストリが許可するダミー値のみ）。 */
export const DEFAULT_REGISTRANT_PROFILE: RegistrantProfile = {
  name: "Taro Test",
  email: "taro.test@example.com",
  street: "N/A",
  city: "N/A",
  countryCode: "JP",
};

/** EPP `create` の正規化入力。contact 省略時は DEFAULT_REGISTRANT_PROFILE を使う。 */
export interface CreateInput {
  name: string;
  periodYears: number;
  nameservers?: string[];
  /** 移管パスフレーズ（1〜64 文字）。 */
  authInfo: string;
  contact?: RegistrantProfile;
}

/** EPP `renew` の正規化入力。curExpDate は取り違え防止のためレジストリ側で必須。 */
export interface RenewInput {
  periodYears: number;
  /** 現在の有効期限（ISO 8601 または YYYY-MM-DD）。 */
  currentExpiresAt: string;
}

/** EPP `update` の正規化入力（add / rem の差分指定）。 */
export interface UpdateInput {
  addNameservers?: string[];
  removeNameservers?: string[];
  addStatuses?: ClientStatus[];
  removeStatuses?: ClientStatus[];
}

/** EPP `delete` の正規化結果。 */
export interface DeleteResult {
  name: string;
}

/**
 * 移管の正規化ステータス（docs/requirements.md §11.1 / ADR-0002）。
 *
 * `none` は「移管中でない」。transfer query の専用エンドポイントが無く `transferQuery` が
 * `info` の `pendingTransfer` から導出するため、pending の反対側を表す値が要る。
 * `transfers.status`（§9.1）は `none` を持たない（正規化型が DB の値域の上位集合）。
 */
export const TRANSFER_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "none",
] as const;

export const transferStatusSchema = z.enum(TRANSFER_STATUSES);
export type TransferStatus = z.infer<typeof transferStatusSchema>;

/**
 * EPP `transfer` 系（request / query / approve / reject / cancel）の正規化結果。
 *
 * レジストリの語彙（`gainingRegistrar` / `losingRegistrar`）は申請時点の役割語で、
 * 承認・拒否・取消の応答や Poll 通知では direction（in / out）と一対一にならない。
 * ここでは「申請した側 / 対応する側」という視点非依存の語彙にし、direction の導出は
 * 自レジストラ ID との比較としてアプリ側で行う（ADR-0002）。
 */
export interface TransferResult {
  name: string;
  status: TransferStatus;
  /** レジストリが返した移管状態の生値（trStatus 相当）。正規化で潰れた情報を残す。 */
  registryStatus?: string;
  /** 移管を申請した側のレジストラ ID（レジストリの gainingRegistrar）。 */
  requestingRegistrarId?: string;
  /** 承認 / 拒否の権限を持つ側のレジストラ ID（レジストリの losingRegistrar）。 */
  actingRegistrarId?: string;
  /** 申請日時（ISO 8601）。kitaqnic の reDate。kitaqsign は返さない。 */
  requestedAt?: string;
  /** 自動承認の期限（ISO 8601）。kitaqnic の acDate。kitaqsign は返さない。 */
  actByAt?: string;
  /**
   * 移管完了後の新しい有効期限（ISO 8601）。
   * 両レジストリの transfer 応答に exDate が無いため当面は常に undefined
   * （埋めるには移管後の `info` 追い読みが要る）。
   */
  newExpiresAt?: string;
  /**
   * レジストリの生応答（エンベロープ）。`transfers.raw`（§9.1）への保存・障害調査・
   * 契約テストの fixture 化に使う。使う側が zod で検証してから読む前提の `unknown`。
   * クライアントへは返さない（API は `transferResponseSchema` で剥がす。ADR-0002）。
   */
  raw: unknown;
}

/**
 * Poll 通知の種別（docs/requirements.md §11.1 / ADR-0002）。
 *
 * これは正規化側の語彙で、レジストリが返す生の `msgType` とは別物
 * （両 OpenAPI の `PollMessageDto.msgType` に enum も例も無い【要確認: §21.2 #13】）。
 * 対応づけられない通知は捨てずに `unknown` として保持する。
 * `operation_logs.command` の `transfer_approve` 等（`operation-log.ts`）とは別語彙で、
 * こちらは「起きた事実」を過去形で表す。
 */
export const POLL_MESSAGE_TYPES = [
  "transfer_request",
  "transfer_approved",
  "transfer_rejected",
  "transfer_cancelled",
  "unknown",
] as const;

export const pollMessageTypeSchema = z.enum(POLL_MESSAGE_TYPES);
export type PollMessageType = z.infer<typeof pollMessageTypeSchema>;

/**
 * Poll（非同期通知）1 件の正規化結果。`GET /messages` は最古の未 ack を 1 件返す FIFO で、
 * ack するまで同じメッセージが返り続ける（docs/registry/spec-notes.md）。
 * 通知が無ければアダプタは PollMessage ではなく null を返す。
 */
export interface PollMessage {
  /**
   * メッセージ ID。レジストリは int64 で返すが string に正規化する
   * （`transfers.registry_message_id`（§9.1）が text の一意キーで、number では桁が落ちうる）。
   * ack のパスに埋めるときに数値へ戻す責務はアダプタ側にある。
   */
  id: string;
  /** 未 ack の残件数（レジストリの `PollResponse.count`）。 */
  count: number;
  /** キュー投入日時（ISO 8601）。レジストリの qdate。 */
  queuedAt: string;
  type: PollMessageType;
  /** 通知の対象ドメイン（payload から取れた場合）。 */
  domainName?: string;
  /** 通知に移管情報が含まれる場合の正規化結果。 */
  transfer?: TransferResult;
  /** レジストリの生応答（エンベロープ）。{@link TransferResult.raw} と同じ扱い。 */
  raw: unknown;
}

/** `hello`（疎通確認）の正規化結果。 */
export interface HelloResult {
  registry: RegistryId;
  tlds: string[];
}
