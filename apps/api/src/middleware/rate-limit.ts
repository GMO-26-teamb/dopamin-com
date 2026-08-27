import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { ApiException } from "../lib/errors";
import type { AppEnv } from "../types";

/**
 * 認証なしで叩けるルートのレート制限。
 *
 * 未認証だと絞り込める単位が接続元しか無いので、IP 単位のトークンバケットで数える。
 * 値の定義はここ 1 か所（ルート側は持たない）。
 *
 * **限界**: 状態はインスタンスのメモリにしか無い。Vercel Functions は同時実行ぶんだけ
 * インスタンスが増え、しばらく呼ばれなければ捨てられるので、実効の上限は
 * 「1 インスタンスあたり毎分 10 回」であって全体の厳密な上限ではない。
 * ここで守りたいのは「1 本の接続元が 1 インスタンスを占有し続けないこと」までで、
 * 全体の上限が要るようになったら外部の共有ストアに寄せる（その時点で ADR を書く）。
 */
export const UNAUTHENTICATED_RATE_LIMIT = {
  /** バケットの容量。一気に叩ける回数の上限。 */
  limit: 10,
  /** 空のバケットが満タンに戻るまでの時間（ms）。 */
  windowMs: 60_000,
} as const;

/** 1ms あたりの補充量。`limit / windowMs`。 */
const REFILL_PER_MS =
  UNAUTHENTICATED_RATE_LIMIT.limit / UNAUTHENTICATED_RATE_LIMIT.windowMs;

interface Bucket {
  /** 残トークン。経過時間に比例して補充するので小数を持つ。 */
  tokens: number;
  /** 最後に補充した時刻（ms）。 */
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

/** 満タンに戻ったバケットを捨てる間隔。Map が接続元の数だけ太り続けないようにする。 */
const SWEEP_INTERVAL_MS = UNAUTHENTICATED_RATE_LIMIT.windowMs;
let lastSweptAt = 0;

/** `updatedAt` から `now` までに補充されたぶんを足した残トークン（上限は容量）。 */
function refilled(bucket: Bucket, now: number): number {
  return Math.min(
    UNAUTHENTICATED_RATE_LIMIT.limit,
    bucket.tokens + Math.max(0, now - bucket.updatedAt) * REFILL_PER_MS,
  );
}

/** 満タン = 何も制限していないのと同じ状態のバケットを削除する。 */
function sweep(now: number): void {
  if (now - lastSweptAt < SWEEP_INTERVAL_MS) {
    return;
  }
  lastSweptAt = now;
  for (const [key, bucket] of buckets) {
    if (refilled(bucket, now) >= UNAUTHENTICATED_RATE_LIMIT.limit) {
      buckets.delete(key);
    }
  }
}

/**
 * 数える単位（接続元の IP）。
 *
 * **クライアントが付けられるヘッダを信用しないこと。** `x-forwarded-for` は
 * 前段が「追記」するヘッダで、呼び出し側が自分で載せてくることもある。先頭を鍵に
 * すると、毎回でたらめな値を付けるだけで新しいバケットが割り当てられ、制限を
 * まるごと迂回できてしまう。
 *
 * そこで、
 * 1. `x-vercel-forwarded-for`（Vercel の edge が付けるので詐称できない）
 * 2. `x-real-ip`（同上）
 * 3. `x-forwarded-for` の **末尾**（＝自分に一番近いホップ。手前が追記した値なので、
 *    呼び出し側が載せた値はその前に押し出される）
 * の順に見る。
 *
 * どれも取れなければ全員をまとめて 1 つのバケットに入れる（緩めるより締める側に倒す）。
 * 前段のプロキシが無い環境で素のまま公開すると、この鍵は信用できない。
 */
function firstNonEmpty(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function clientKey(c: Context): string {
  const vercel = firstNonEmpty(c.req.header("x-vercel-forwarded-for"));
  if (vercel !== undefined) {
    return vercel;
  }
  const real = firstNonEmpty(c.req.header("x-real-ip"));
  if (real !== undefined) {
    return real;
  }
  const hops = c.req
    .header("x-forwarded-for")
    ?.split(",")
    .map((hop) => hop.trim())
    .filter((hop) => hop !== "");
  return hops === undefined || hops.length === 0
    ? "unknown"
    : (hops[hops.length - 1] as string);
}

/** 次の 1 回が通るまでの秒数（最低 1 秒）。§10.3 の `details.retryAfter` に載せる。 */
function retryAfterSeconds(tokens: number): number {
  return Math.max(1, Math.ceil((1 - tokens) / REFILL_PER_MS / 1000));
}

/**
 * 認証なしのルートに掛けるレート制限。超過は `RATE_LIMITED`（§10.3）で、
 * 何秒後に試せるかを `details.retryAfter`（秒）と `Retry-After` ヘッダで返す。
 */
export const unauthenticatedRateLimit = createMiddleware<AppEnv>(
  async (c, next) => {
    const now = Date.now();
    sweep(now);

    const key = clientKey(c);
    const bucket = buckets.get(key) ?? {
      tokens: UNAUTHENTICATED_RATE_LIMIT.limit,
      updatedAt: now,
    };
    const tokens = refilled(bucket, now);

    if (tokens < 1) {
      buckets.set(key, { tokens, updatedAt: now });
      const retryAfter = retryAfterSeconds(tokens);
      c.header("retry-after", String(retryAfter));
      throw new ApiException(
        "RATE_LIMITED",
        "アクセスが集中しています。",
        { retryAfter },
        { retryable: true },
      );
    }

    buckets.set(key, { tokens: tokens - 1, updatedAt: now });
    await next();
  },
);

/** テスト用: 数え上げた状態を捨てる（テスト間で残トークンを持ち越さないため）。 */
export function resetRateLimitForTesting(): void {
  buckets.clear();
  lastSweptAt = 0;
}
