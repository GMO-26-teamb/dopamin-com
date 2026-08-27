/**
 * 操作ログ（レジストリ通信ログ）の語彙（docs/requirements.md §9.1 operation_logs / FR-15 / FR-18）。
 *
 * `command` はレジストリ通信の「正準名」であり、アプリ全体（`packages/registry` の
 * エラーメッセージ・`operation_logs.command`・画面のフィルタ）で同じ識別子を使う。
 * レジストリごとの HTTP パス（`/domains/{name}/rotate-auth-info` など）とは別語彙で、
 * 対応付けは `packages/registry` の中だけで行う（CLAUDE.md「レジストリ固有の処理」）。
 */

import { z } from "zod";

/**
 * 主コマンド 15 種（docs/requirements.md §9.1）。
 * `RegistryAdapter` の公開メソッド 1 回 = このいずれか 1 件のログ、が原則。
 */
export const PRIMARY_OPERATION_COMMANDS = [
  "check",
  "info",
  "create",
  "renew",
  "update",
  "delete",
  "restore",
  "transfer_request",
  "transfer_query",
  "transfer_approve",
  "transfer_reject",
  "transfer_cancel",
  "auth_info",
  "poll",
  "ack",
] as const;

/**
 * 補助コマンド。主コマンドの内部、または主コマンドと無関係に単独で発行される
 * レジストリ呼び出しで、要件 v0.1.7 で `operation_logs.command` の enum に追加した。
 *
 * 主コマンドに寄せず独立した値として記録する理由:
 * - `hello`（疎通確認・`GET /health`）には親になる主コマンドが存在しない
 * - `host_info` / `host_create`（NS の自動作成）と `contact_create` は
 *   `create` / `update` の内部で失敗し得る。親名で記録すると AC-15-1 の
 *   「エラー種別付きで記録」から「どの副呼び出しで落ちたか」が失われる
 */
export const AUXILIARY_OPERATION_COMMANDS = [
  "hello",
  "host_info",
  "host_create",
  "contact_create",
  // コンタクトの再利用（#72）で、プロファイル変更時に単独で発行される
  "contact_update",
] as const;

/**
 * レジストリ通信を伴わないアプリ内操作。
 *
 * FR-13 の「DNS に反映」（疑似 DNS ゾーンへの反映）は、要件が
 * 「操作ログ（FR-15）に `subdomain_plan.apply` として記録し、AI 呼び出しは伴わない」と
 * 定めているのでここに置く。同じ反映処理のなかで NS 切替が起きた場合、その
 * レジストリ呼び出しは従来どおり `update` として別行で記録される。
 */
export const APP_OPERATION_COMMANDS = ["subdomain_plan.apply"] as const;

/** `operation_logs.command` に入り得る値のすべて（主 15 種 + 補助 5 種 + アプリ内 1 種）。 */
export const OPERATION_COMMANDS = [
  ...PRIMARY_OPERATION_COMMANDS,
  ...AUXILIARY_OPERATION_COMMANDS,
  ...APP_OPERATION_COMMANDS,
] as const;

export const operationCommandSchema = z.enum(OPERATION_COMMANDS);
export type OperationCommand = z.infer<typeof operationCommandSchema>;

export const primaryOperationCommandSchema = z.enum(PRIMARY_OPERATION_COMMANDS);
export type PrimaryOperationCommand = z.infer<
  typeof primaryOperationCommandSchema
>;

export type AuxiliaryOperationCommand =
  (typeof AUXILIARY_OPERATION_COMMANDS)[number];

/** 補助コマンド（主コマンドの内部で発行される・親を持たない）か。 */
export function isAuxiliaryOperationCommand(
  command: OperationCommand,
): command is AuxiliaryOperationCommand {
  return (AUXILIARY_OPERATION_COMMANDS as readonly string[]).includes(command);
}

/** 操作ログの結果種別（docs/requirements.md §9.1 / AC-15-1）。 */
export const OPERATION_LOG_STATUSES = [
  "success",
  "error",
  "timeout",
  "spec_mismatch",
] as const;

export const operationLogStatusSchema = z.enum(OPERATION_LOG_STATUSES);
export type OperationLogStatus = z.infer<typeof operationLogStatusSchema>;

/**
 * 統一エラーコード（§10.3）から操作ログの結果種別を導く。
 * タイムアウトと仕様不一致だけを個別種別にし、他の失敗は `error` に寄せる（AC-15-1）。
 */
export function operationLogStatusFromErrorCode(
  errorCode: string | null | undefined,
): OperationLogStatus {
  if (!errorCode) {
    return "success";
  }
  if (errorCode === "REGISTRY_TIMEOUT") {
    return "timeout";
  }
  if (errorCode === "REGISTRY_SPEC_MISMATCH") {
    return "spec_mismatch";
  }
  return "error";
}
