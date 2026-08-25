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

/** EPP `transfer` の正規化結果。status はレジストリの返す移管状態（pending 等）。 */
export interface TransferResult {
  name: string;
  status: string;
  gainingRegistrar: string | null;
  losingRegistrar: string | null;
}

/** `hello`（疎通確認）の正規化結果。 */
export interface HelloResult {
  registry: RegistryId;
  tlds: string[];
}
