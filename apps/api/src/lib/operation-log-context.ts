import { AsyncLocalStorage } from "node:async_hooks";

/**
 * 操作ログ（FR-15）用のリクエストコンテキスト。
 * レジストリアダプタはプロセス内シングルトンのため、userId / requestId は
 * 引数で引き回さず AsyncLocalStorage で伝搬する（§9.1 user_id / request_id）。
 */
interface RequestLogContext {
  requestId: string;
  /** requireSession 通過後に補完される。未認証ルート（/health 等）は null のまま。 */
  userId: string | null;
  /**
   * clTRID 採番用の連番（同一 API リクエスト内で 1, 2, ...）。
   * `runAsSystem` が作る子コンテキストと同じオブジェクトを共有し、
   * userId を落としても採番は 1 リクエストで通し番号のまま続ける。
   */
  seq: { value: number };
}

const storage = new AsyncLocalStorage<RequestLogContext>();

/** clTRID は 64 文字以内（docs/registry/spec-notes.md）。連番の分を差し引いた上限。 */
const CL_TRID_BASE_MAX = 56;

/** ミドルウェアがリクエスト処理全体をこのコンテキストで包む。 */
export function runWithRequestContext<T>(
  requestId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run({ requestId, userId: null, seq: { value: 0 } }, fn);
}

/**
 * システム起点の処理を `userId = null` のコンテキストで実行する（§9.1 / #250）。
 *
 * Poll のキューはレジストラ単位で全ユーザー分が混ざる。消化を起動したユーザーの
 * コンテキストのまま走らせると、他ユーザーのドメインへの呼び出しがその起動者の
 * `user_id` で `operation_logs` に入り、読み出し（`user_id = 自分`）でそのまま
 * 他人の画面に出てしまう（NFR-04 違反）。
 *
 * requestId と clTRID の連番は引き継ぐ: 誰の操作でもないが、どの API リクエストが
 * 引き起こしたかは障害調査で追えるようにしておく。
 */
export function runAsSystem<T>(fn: () => Promise<T>): Promise<T> {
  const store = storage.getStore();
  if (!store) {
    return fn();
  }
  return storage.run({ ...store, userId: null }, fn);
}

/** 現在のコンテキスト。ALS の外（テスト・スクリプト等）では両方 null。 */
export function getRequestContext(): {
  requestId: string | null;
  userId: string | null;
} {
  const store = storage.getStore();
  return {
    requestId: store?.requestId ?? null,
    userId: store?.userId ?? null,
  };
}

/** requireSession が認証済みユーザーを補完する。 */
export function setContextUserId(userId: string): void {
  const store = storage.getStore();
  if (store) {
    store.userId = userId;
  }
}

/**
 * clTRID を採番する（`<requestId>-<連番>`）。operation_logs.request_id と一致させ（§9.1）、
 * prefix で同一 API リクエスト内の複数レジストリ呼び出しを相関できるようにする。
 * ALS の外では null（アダプタ既定の採番にフォールバックさせる）。
 * seq のインクリメントは同期処理なので Promise.all の並行呼び出しでも競合しない。
 */
export function nextClTrid(): string | null {
  const store = storage.getStore();
  if (!store) {
    return null;
  }
  store.seq.value += 1;
  return `${store.requestId.slice(0, CL_TRID_BASE_MAX)}-${store.seq.value}`;
}
