import type {
  OperationCommand,
  OperationLogStatus,
  RegistryId,
} from "@dopamin/shared";
import type { RegistryErrorCode } from "./errors";

/**
 * レジストリ呼び出し 1 回分の観測レコード（docs/requirements.md §9.1 / FR-15）。
 *
 * 実レジストリでは「1 HTTP 呼び出し = 1 レコード」で、`create` 内部の補助コマンド
 * （host_info / host_create / contact_create）も独立したレコードになる（v0.1.7 / AC-15-1）。
 * アダプタは成功・失敗を問わずレコードを発行するだけで、マスク・保存・出力は
 * 受け手（apps/api の RegistryClient ラッパー）の責務（§11.1）。
 */
export interface RegistryCallRecord {
  registry: RegistryId;
  command: OperationCommand;
  /** 対象ドメイン。check（複数件）や hello のように対象を特定できない場合は null。 */
  domainName: string | null;
  /** X-Cl-TRID に送った値。operation_logs.request_id と一致させる（§9.1）。 */
  clTrid: string;
  /** レジストリ採番のトレース ID。応答が得られなかった場合は null。 */
  svTrid: string | null;
  status: OperationLogStatus;
  errorCode: RegistryErrorCode | null;
  /** レジストリが返した EPP result code の文字列。 */
  registryCode: string | null;
  /**
   * 未マスクの送信内容。認証ヘッダは含めない（そもそもログ経路に乗せない）。
   * マスク（AC-15-2）は保存側の責務。
   */
  request: unknown;
  /** 未マスクの受信内容（エラー時は得られた範囲の要約）。 */
  response: unknown;
  latencyMs: number;
}

/**
 * レコードの受け手。戻りの Promise はアダプタが await する
 * （serverless で関数がフリーズしても書き込みが失われないようにするため）。
 * observer が throw してもレジストリ操作の成否には影響させない。
 */
export type RegistryCallObserver = (
  record: RegistryCallRecord,
) => void | Promise<void>;

/**
 * clTRID の採番を呼び出し側（apps/api）が上書きするためのフック。
 * null を返した場合はアダプタ既定の採番にフォールバックする。
 * 値は 64 文字以内（docs/registry/spec-notes.md）。
 */
export type ClTridFactory = () => string | null;
