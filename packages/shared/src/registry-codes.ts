import type { OperationCommand } from "./operation-log";

/**
 * レジストリの result code（EPP result code 相当）→ ユーザー向けの理由文
 * （docs/requirements.md §10.3 / AC-12-2）。
 *
 * **この表がユーザー向け文言の唯一の定義**。API のエラー応答（`apps/api` の
 * `registryErrorMessage`）と画面の Error Card（`apps/web` の `toErrorCopy`）が
 * 同じ表を読む。`packages/registry` からも re-export しているが実体はここに置く:
 * `@dopamin/registry` はアダプタ実装（`node:crypto` 依存）を同じエントリから
 * export していてブラウザから import できないため（`registry/src/routing.ts` の
 * TLD 表と同じ理由）。
 *
 * 正規化エラーコード（`REGISTRY_REJECTED` など）だけでは「なぜ断られたか」が画面に出ない。
 * ユーザーが自分で直せる失敗（AuthCode の間違い・重複申請・移管対象外）は原因まで返す。
 * FR-18 に従い、レジストリの生メッセージは載せずここで言い換える。
 *
 * 実際に返る result code は実測待ちなので【要確認: §21.2 #16】、判明したらここだけを差し替える。
 */

/** 移管系コマンド（result code の読み方が移管文脈になるもの）。 */
const TRANSFER_COMMANDS: ReadonlySet<OperationCommand> = new Set([
  "transfer_request",
  "transfer_query",
  "transfer_approve",
  "transfer_reject",
  "transfer_cancel",
]);

/**
 * コマンドに依らず読み方が決まる code。
 * キーは string（`ApiError.registryCode` が string で届くため）。
 */
const MESSAGE_BY_CODE: Readonly<Record<string, string>> = {
  // 2106 Object is not eligible for transfer
  "2106": "このドメインは移管の対象外です。",
  // 2300 Object pending transfer / 2301 Object not pending transfer。
  // どちらも利用者には「申請の状態が合っていない」ことが分かれば足りる
  "2300": "すでに移管申請中です。",
  "2301": "すでに移管申請中です。",
  // 2303 Object does not exist
  "2303": "このドメインは登録されていません。",
};

/**
 * コマンドで読み方が変わる code。
 * 移管系コマンドかどうかで文言を選ぶ（ユーザーが操作した画面の語彙に合わせる）。
 */
const MESSAGE_BY_CODE_AND_CONTEXT: Readonly<
  Record<string, { transfer: string; other: string }>
> = {
  // 2202 Invalid authorization information
  "2202": {
    transfer: "AuthCode が正しくありません。",
    other: "認証情報が正しくありません。",
  },
  // 2304 Object status prohibits operation
  "2304": {
    transfer: "現在のステータスでは移管できません（移管ロックなど）。",
    other: "現在のステータスではこの操作を実行できません。",
  },
};

/**
 * result code → ユーザー向けの理由文。表に無ければ `null`
 * （呼び出し側が正規化コード基準の既定文言を使う）。
 *
 * `command` を渡せない場面（画面側はエラー応答に command を持たない）では
 * 移管文脈の文言に倒す。これらの code が出るのは実質移管操作のためで、
 * 汎用文言に倒すと肝心の AC-12-2 の理由が消えるほうが痛い。
 */
export function userMessageForRegistryCode(
  resultCode: string | number | undefined | null,
  command?: OperationCommand,
): string | null {
  if (resultCode === undefined || resultCode === null) {
    return null;
  }
  const key = String(resultCode);
  const contextual = MESSAGE_BY_CODE_AND_CONTEXT[key];
  if (contextual !== undefined) {
    const isTransfer = command === undefined || TRANSFER_COMMANDS.has(command);
    return isTransfer ? contextual.transfer : contextual.other;
  }
  return MESSAGE_BY_CODE[key] ?? null;
}
