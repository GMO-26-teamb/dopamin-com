import { RegistryError } from "@dopamin/registry";

/**
 * 参照系コマンドの自動再試行（docs/requirements.md FR-18 / §11.6 (e) / AC-05-2）。
 *
 * **更新系には使わない**（NFR-02）。create / renew / update / delete / restore と移管の
 * 承認・拒否・取消は、応答が届かなくても実際には成立していることがあるため、再送すると
 * 二重実行になる。それらの取り扱いは `reconcileOnTimeout`（再送せず参照系で照合）が担う。
 *
 * 置き場所を `packages/registry` の HTTP クライアントではなく API 層にしているのは、
 * mock アダプタでも再試行の挙動を検証できるようにするため（issue #60）。
 * レジストリごとの差ではなくアプリの方針なので、Bridge 層の外に置く方が筋も通る。
 */

/** 再試行の既定回数（初回 + 2 回 = 最大 3 回の呼び出し）。 */
export const READ_RETRY_COUNT = 2;

/** 指数バックオフの基準時間。待ち時間は 300ms → 600ms。 */
export const READ_RETRY_BASE_MS = 300;

/**
 * 再試行してよい失敗か。
 *
 * 繋がらない・応答が返らない場合だけ。`REGISTRY_REJECTED` / `NOT_FOUND` /
 * `CONFLICT` / `OPERATION_NOT_ALLOWED` は「レジストリ側の事実」なので、
 * 何度投げても同じ答えが返るだけで待ち時間が伸びる。
 * `REGISTRY_SPEC_MISMATCH` も応答自体は届いているので再試行しない。
 */
function isRetryable(err: unknown): boolean {
  return (
    err instanceof RegistryError &&
    (err.code === "REGISTRY_TIMEOUT" || err.code === "REGISTRY_UNAVAILABLE")
  );
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let sleepImpl: (ms: number) => Promise<void> = defaultSleep;

/**
 * テスト専用: バックオフの待機を差し替える（null で既定に戻す）。
 * 再試行「回数」の検証に実時間を待たせないための seam。本番コードからは呼ばない。
 */
export function setRetrySleepForTesting(
  sleep: ((ms: number) => Promise<void>) | null,
): void {
  sleepImpl = sleep ?? defaultSleep;
}

export interface ReadRetryOptions {
  /** 再試行の回数（初回は含まない）。既定 {@link READ_RETRY_COUNT}。 */
  retries?: number;
  /** 指数バックオフの基準時間。既定 {@link READ_RETRY_BASE_MS}。 */
  baseMs?: number;
}

/**
 * 参照系コマンドを、繋がらない場合だけ指数バックオフで再試行する。
 *
 * 最後の試行が失敗したらその例外をそのまま投げる（元のコード・registry・
 * registryCode を保つので、呼び出し側の分岐（stale フォールバック等）は変わらない）。
 */
export async function withReadRetry<T>(
  fn: () => Promise<T>,
  options: ReadRetryOptions = {},
): Promise<T> {
  const retries = options.retries ?? READ_RETRY_COUNT;
  const baseMs = options.baseMs ?? READ_RETRY_BASE_MS;

  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) {
        throw err;
      }
      await sleepImpl(baseMs * 2 ** attempt);
      attempt += 1;
    }
  }
}
