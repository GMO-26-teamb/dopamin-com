import type { OperationCommand, RegistryId } from "@dopamin/shared";

/**
 * アダプタが投げる正規化エラーのコード（docs/requirements.md §10.3 のサブセット）。
 * API 層はこのコードを HTTP ステータスへ変換する。
 */
export const REGISTRY_ERROR_CODES = [
  "NOT_FOUND",
  "CONFLICT",
  "OPERATION_NOT_ALLOWED",
  "REGISTRY_REJECTED",
  "REGISTRY_TIMEOUT",
  "REGISTRY_UNAVAILABLE",
  "REGISTRY_SPEC_MISMATCH",
] as const;

export type RegistryErrorCode = (typeof REGISTRY_ERROR_CODES)[number];

const RETRYABLE_CODES: ReadonlySet<RegistryErrorCode> = new Set([
  "REGISTRY_TIMEOUT",
  "REGISTRY_UNAVAILABLE",
]);

/** レジストリ通信の失敗を正規化した例外。レジストリ固有のコードは registryCode に保持する。 */
export class RegistryError extends Error {
  readonly code: RegistryErrorCode;
  readonly registry: RegistryId;
  /** レジストリが返した EPP result code（例: 2303）。 */
  readonly registryCode?: number;
  /** レジストリが返した人間向け詳細（UI にはそのまま出さない）。 */
  readonly reason?: string;
  readonly httpStatus?: number;
  /** レジストリ採番のトレース ID（応答エンベロープが得られた場合のみ。操作ログ用）。 */
  readonly svTrid?: string;
  /**
   * 失敗したコマンドの正準名（`OperationCommand`）。
   * 同じ result code でもコマンドによって読み方が変わるため、
   * ユーザー向け文言の出し分け（{@link userMessageForRegistryCode}）に使う。
   */
  readonly command?: OperationCommand;

  constructor(options: {
    code: RegistryErrorCode;
    registry: RegistryId;
    message: string;
    registryCode?: number;
    reason?: string;
    httpStatus?: number;
    svTrid?: string;
    command?: OperationCommand;
    cause?: unknown;
  }) {
    super(
      options.message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "RegistryError";
    this.code = options.code;
    this.registry = options.registry;
    this.registryCode = options.registryCode;
    this.reason = options.reason;
    this.httpStatus = options.httpStatus;
    this.svTrid = options.svTrid;
    this.command = options.command;
  }

  get retryable(): boolean {
    return RETRYABLE_CODES.has(this.code);
  }

  /**
   * コマンド名を足した複製を返す。エラーを組み立てる場所（`gate` や下位の検証）が
   * どのコマンドから呼ばれたかを知らない場合に、外側のラッパーから補うために使う。
   * 既にコマンドが入っていればそのまま返す。
   */
  withCommand(command: OperationCommand): RegistryError {
    if (this.command !== undefined) {
      return this;
    }
    return new RegistryError({
      code: this.code,
      registry: this.registry,
      message: this.message,
      registryCode: this.registryCode,
      reason: this.reason,
      httpStatus: this.httpStatus,
      svTrid: this.svTrid,
      command,
      cause: this.cause,
    });
  }
}

/**
 * result code → ユーザー向けの理由文（§10.3 / AC-12-2）。
 * 実体は `@dopamin/shared` の `registry-codes.ts`（画面側も同じ表を読むため。
 * このパッケージはブラウザから import できない）。Bridge 層から従来どおり
 * 参照できるようにする re-export。
 */
export { userMessageForRegistryCode } from "@dopamin/shared";

/** EPP result code → 正規化エラーコードの対応（RFC 5730 の意味論に準拠）。 */
export function errorCodeForEppResult(resultCode: number): RegistryErrorCode {
  switch (resultCode) {
    case 2302: // Object exists
      return "CONFLICT";
    case 2303: // Object does not exist
      return "NOT_FOUND";
    case 2304: // Object status prohibits operation
      return "OPERATION_NOT_ALLOWED";
    default:
      return "REGISTRY_REJECTED";
  }
}
