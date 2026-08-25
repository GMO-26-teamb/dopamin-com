import { RegistryError } from "@dopamin/registry";

/**
 * AC-06-2 / AC-18-2: 更新系コマンドがタイムアウトした場合、二重送信を避けるため
 * 再送はせず、参照系（info 等）でレジストリ側の結果を照合して確定する。
 *
 * - `operation` が REGISTRY_TIMEOUT 以外で失敗した場合はそのまま投げ直す。
 * - タイムアウト時は `confirm` を 1 回だけ実行し、反映が確認できた場合
 *   （null 以外が返った場合）はその値を成功として返す。
 * - 反映が確認できない・照合自体が失敗した場合は元のタイムアウトを投げ直す
 *   （偽の成功を返すより、ユーザーに再確認を促す方が安全）。
 */
export async function reconcileOnTimeout<T>(
  operation: () => Promise<T>,
  confirm: () => Promise<T | null>,
): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    if (!(err instanceof RegistryError) || err.code !== "REGISTRY_TIMEOUT") {
      throw err;
    }
    let confirmed: T | null;
    try {
      confirmed = await confirm();
    } catch {
      confirmed = null;
    }
    if (confirmed === null) {
      throw err;
    }
    return confirmed;
  }
}
